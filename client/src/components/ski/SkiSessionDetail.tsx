/**
 * Ficha de una sesión de Ski Net · Escuela (diálogo): datos, alumnos inscritos (alta y anulación) y profesor
 * (propuesta de compatibles con los descartados y su motivo, asignar, quitar). El servidor vuelve a comprobar todas
 * las reglas al asignar o inscribir y rechaza con un mensaje claro lo que no encaja.
 */
import { useState } from "react";
import { ClipboardCheck, UserCheck, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { KIND_LABEL, formatDay, labelOf, toastSki, type ProductKind, type SkiCtx } from "@/components/ski/SkiSchoolShell";

export const STATUS_LABEL: Record<string, string> = { pending: "Sin profesor", assigned: "Asignada", completed: "Impartida", cancelled: "Cancelada" };
export const statusVariant = (s: string) => (s === "assigned" ? "default" : s === "pending" ? "destructive" : "secondary") as "default" | "destructive" | "secondary";

function useRefresh() {
  const utils = trpc.useUtils();
  return () => {
    utils.skiSchool.getSession.invalidate();
    utils.skiSchool.listSessions.invalidate();
    utils.skiSchool.planning.invalidate();
    utils.skiSchool.suggestInstructors.invalidate();
  };
}

function AssignPanel({ ctx, sessionId, current }: { ctx: SkiCtx; sessionId: number; current: number | null }) {
  const refresh = useRefresh();
  const sug = trpc.skiSchool.suggestInstructors.useQuery({ siteId: ctx.siteId, sessionId });
  const assign = trpc.skiSchool.assignInstructor.useMutation({ onSuccess: () => (toast.success("Profesor asignado"), refresh()), onError: toastSki });
  if (sug.isLoading) return <PanelLoading label="Buscando profesores compatibles…" />;
  if (sug.error) return <PanelError error={sug.error} onRetry={() => sug.refetch()} />;
  const { candidates, discarded } = sug.data!;
  return (
    <div className="space-y-3">
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún profesor activo puede dar esta sesión. Revisa la disponibilidad o da de alta a otro profesor.</p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((c, i) => (
            <li key={c.instructorId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium text-foreground">
                  {c.fullName} {i === 0 && <Badge className="ml-1">Propuesta</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">{c.reasons.join(" · ")}</p>
              </div>
              {ctx.canWrite && c.instructorId !== current && (
                <Button size="sm" disabled={assign.isPending} onClick={() => assign.mutate({ siteId: ctx.siteId, sessionId, instructorId: c.instructorId })}>
                  Asignar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {discarded.length > 0 && (
        <details className="rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer text-muted-foreground">No encajan ({discarded.length})</summary>
          <ul className="mt-2 space-y-1">
            {discarded.map((d) => (
              <li key={d.instructorId} className="break-words text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{d.fullName}</span>: {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const ATT_LABEL: Record<string, string> = { present: "Presente", late: "Con retraso", absent: "Ausente" };

/** Pasar lista una sola vez (todos los inscritos): la sesión queda impartida y cuenta para el control de horas. */
function Attendance({ ctx, sessionId, enrolled, canTake }: { ctx: SkiCtx; sessionId: number; enrolled: Array<{ id: number; name: string }>; canTake: boolean }) {
  const utils = trpc.useUtils();
  const q = trpc.skiSchool.getAttendance.useQuery({ siteId: ctx.siteId, sessionId });
  const [marks, setMarks] = useState<Record<number, "present" | "late" | "absent">>({});
  const save = trpc.skiSchool.recordAttendance.useMutation({
    onSuccess: () => {
      toast.success("Lista guardada. La sesión queda impartida.");
      utils.skiSchool.getAttendance.invalidate();
      utils.skiSchool.getSession.invalidate();
      utils.skiSchool.listSessions.invalidate();
      utils.skiSchool.planning.invalidate();
      utils.skiSchool.hoursSummary.invalidate();
    },
    onError: toastSki,
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const { closure, entries } = q.data!;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
        Asistencia
      </h3>
      {closure ? (
        <p className="text-sm text-muted-foreground">
          Lista pasada el {new Date(closure.closedAt).toLocaleString("es-ES")}: {closure.present} presentes, {closure.absent} ausentes
          {entries.length ? ` (${entries.map((e) => `${enrolled.find((p) => p.id === e.participantId)?.name ?? "#" + e.participantId}: ${ATT_LABEL[e.status]}`).join(", ")})` : ""}.
        </p>
      ) : !canTake ? (
        <p className="text-sm text-muted-foreground">Asigna un profesor para poder pasar lista.</p>
      ) : enrolled.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin alumnos inscritos: al pasar lista la sesión queda impartida.</p>
      ) : null}
      {!closure && canTake && ctx.canWrite && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ siteId: ctx.siteId, sessionId, entries: enrolled.map((p) => ({ participantId: p.id, status: marks[p.id] ?? "present" })) });
          }}
        >
          <ul className="space-y-1">
            {enrolled.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 break-words text-foreground">{p.name}</span>
                <select aria-label={`Asistencia de ${p.name}`} className={`${selectClass} w-40`} value={marks[p.id] ?? "present"} onChange={(e) => setMarks({ ...marks, [p.id]: e.target.value as "present" })}>
                  {Object.entries(ATT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <Button type="submit" size="sm" disabled={save.isPending}>
            Guardar la lista
          </Button>
        </form>
      )}
    </section>
  );
}

function Detail({ ctx, sessionId }: { ctx: SkiCtx; sessionId: number }) {
  const refresh = useRefresh();
  const q = trpc.skiSchool.getSession.useQuery({ siteId: ctx.siteId, sessionId });
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState("");
  const add = trpc.skiSchool.addParticipant.useMutation({
    onSuccess: () => {
      toast.success("Alumno inscrito");
      setName("");
      setAge("");
      refresh();
    },
    onError: toastSki,
  });
  const cancelP = trpc.skiSchool.cancelParticipant.useMutation({ onSuccess: () => (toast.success("Inscripción anulada"), refresh()), onError: toastSki });
  const unassign = trpc.skiSchool.unassignInstructor.useMutation({ onSuccess: () => (toast.success("Profesor retirado"), refresh()), onError: toastSki });
  const cancel = trpc.skiSchool.cancelSession.useMutation({ onSuccess: () => (toast.success("Sesión cancelada"), refresh()), onError: toastSki });
  const complete = trpc.skiSchool.completeSession.useMutation({ onSuccess: () => (toast.success("Sesión impartida"), refresh()), onError: toastSki });

  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const open = s.status === "pending" || s.status === "assigned";
  const enrolled = s.participants.filter((p) => p.status === "enrolled");

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-foreground">
          <span className="font-medium">{formatDay(s.date)}</span> · {s.startTime}–{s.endTime}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={statusVariant(s.status)}>{STATUS_LABEL[s.status]}</Badge>
          {s.productKind && <Badge variant="outline">{KIND_LABEL[s.productKind as ProductKind]}</Badge>}
          {s.level && <Badge variant="outline">{labelOf(ctx.config.levels, s.level)}</Badge>}
          {s.modality && <Badge variant="outline">{labelOf(ctx.config.modalities, s.modality)}</Badge>}
          {s.language && <Badge variant="outline">{labelOf(ctx.config.languages, s.language)}</Badge>}
          {s.reservationId != null && <Badge variant="outline">Reserva #{s.reservationId}</Badge>}
        </div>
        {s.meetingPoint && <p className="break-words text-xs text-muted-foreground">Punto de encuentro: {s.meetingPoint}</p>}
        {s.notes && <p className="break-words text-xs text-muted-foreground">{s.notes}</p>}
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Profesor</h3>
          {s.instructorName && ctx.canWrite && s.status === "assigned" && (
            <Button size="sm" variant="ghost" onClick={() => unassign.mutate({ siteId: ctx.siteId, sessionId })}>
              <UserMinus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Quitar profesor
            </Button>
          )}
        </div>
        {s.instructorName ? (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <UserCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            {s.instructorName}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía sin profesor.</p>
        )}
        {open && <AssignPanel ctx={ctx} sessionId={sessionId} current={s.instructorId} />}
      </section>

      <section className="space-y-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4" aria-hidden="true" />
          Alumnos ({enrolled.length}/{s.capacity})
        </h3>
        {s.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">Inscribe al primer alumno de esta sesión.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {s.participants.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className={p.status === "cancelled" ? "break-words text-muted-foreground line-through" : "break-words text-foreground"}>
                  {p.name}
                  {p.age != null ? ` · ${p.age} años` : ""}
                  {p.level ? ` · ${labelOf(ctx.config.levels, p.level)}` : ""}
                </span>
                {ctx.canWrite && p.status === "enrolled" && open && (
                  <Button size="sm" variant="ghost" onClick={() => cancelP.mutate({ siteId: ctx.siteId, participantId: p.id })}>
                    Anular
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {ctx.canWrite && open && enrolled.length < s.capacity && (
          <form
            className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_6rem_10rem_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ siteId: ctx.siteId, sessionId, name, age: age.trim() === "" ? null : Number(age), level: level || null });
            }}
          >
            <FormField id="par-name" label="Alumno" required>
              <Input id="par-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </FormField>
            <FormField id="par-age" label="Edad">
              <Input id="par-age" type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
            </FormField>
            <FormField id="par-level" label="Nivel">
              <select id="par-level" className={selectClass} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Sin indicar</option>
                {ctx.config.levels.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </FormField>
            <Button type="submit" disabled={add.isPending}>
              Inscribir
            </Button>
          </form>
        )}
      </section>

      {s.status !== "cancelled" && <Attendance ctx={ctx} sessionId={sessionId} enrolled={enrolled.map((p) => ({ id: p.id, name: p.name }))} canTake={s.instructorId != null} />}

      {ctx.canWrite && open && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {s.status === "assigned" && (
            <Button variant="outline" onClick={() => complete.mutate({ siteId: ctx.siteId, sessionId })}>
              Marcar como impartida
            </Button>
          )}
          <Button variant="ghost" className="text-destructive" onClick={() => cancel.mutate({ siteId: ctx.siteId, sessionId })}>
            Cancelar la sesión
          </Button>
        </div>
      )}
    </div>
  );
}

export function SkiSessionDialog({ ctx, sessionId, title, onClose }: { ctx: SkiCtx; sessionId: number | null; title?: string; onClose: () => void }) {
  return (
    <Dialog open={sessionId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title ?? "Sesión"}</DialogTitle>
          <DialogDescription>Alumnos inscritos y profesor de la sesión.</DialogDescription>
        </DialogHeader>
        {sessionId != null && <Detail ctx={ctx} sessionId={sessionId} />}
      </DialogContent>
    </Dialog>
  );
}
