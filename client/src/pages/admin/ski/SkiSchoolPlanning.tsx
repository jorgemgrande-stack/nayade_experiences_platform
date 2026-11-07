/**
 * Ski Net · Escuela — Planning (/admin/ski/escuela): un día, cada profesor con su disponibilidad, ausencias y
 * sesiones, y las sesiones aún sin profesor para asignarlas. Desde aquí se configura la escuela de la sede
 * (niveles, modalidades, idiomas, horario y límites de carga) y se desactiva sin borrar nada.
 */
import { useState } from "react";
import { Link } from "wouter";
import { CalendarOff, ChevronLeft, ChevronRight, Settings2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField } from "@/components/admin/crm/CrmParts";
import { SkiSchoolShell, addDays, formatDay, labelOf, todayIso, toastSki, type CodeLabel, type SkiCtx } from "@/components/ski/SkiSchoolShell";
import { STATUS_LABEL, SkiSessionDialog, statusVariant } from "@/components/ski/SkiSessionDetail";

const toLines = (l: CodeLabel[]) => l.map((x) => `${x.code} = ${x.label}`).join("\n");
const fromLines = (t: string): CodeLabel[] =>
  t
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return i < 0 ? { code: line, label: line } : { code: line.slice(0, i).trim(), label: line.slice(i + 1).trim() };
    });

function ConfigForm({ ctx, onClose }: { ctx: SkiCtx; onClose: () => void }) {
  const utils = trpc.useUtils();
  const c = ctx.config;
  const [levels, setLevels] = useState(toLines(c.levels));
  const [modalities, setModalities] = useState(toLines(c.modalities));
  const [languages, setLanguages] = useState(toLines(c.languages));
  const [dayStart, setDayStart] = useState(c.dayStart);
  const [dayEnd, setDayEnd] = useState(c.dayEnd);
  const [maxDaily, setMaxDaily] = useState(String(c.limits.maxDailySessions));
  const [maxConsecutive, setMaxConsecutive] = useState(String(c.limits.maxConsecutiveSessions));
  const [transfer, setTransfer] = useState(String(c.limits.minTransferMinutes));
  const save = trpc.skiSchool.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuración guardada");
      utils.skiSchool.invalidate();
      onClose();
    },
    onError: toastSki,
  });
  const deactivate = trpc.skiSchool.deactivateSite.useMutation({
    onSuccess: () => {
      toast.success("Escuela desactivada en esta sede. Los datos se conservan.");
      utils.skiSchool.invalidate();
      onClose();
    },
    onError: toastSki,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          siteId: ctx.siteId,
          levels: fromLines(levels),
          modalities: fromLines(modalities),
          languages: fromLines(languages),
          dayStart,
          dayEnd,
          limits: { maxDailySessions: Number(maxDaily), maxConsecutiveSessions: Number(maxConsecutive), minTransferMinutes: Number(transfer) },
        });
      }}
    >
      <p className="text-xs text-muted-foreground">Una línea por opción, con el formato «código = nombre» (por ejemplo «A = Nivel A · Iniciación»). Los códigos ya usados por profesores o sesiones conviene no cambiarlos.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="cfg-levels" label="Niveles">
          <Textarea id="cfg-levels" rows={5} value={levels} onChange={(e) => setLevels(e.target.value)} />
        </FormField>
        <FormField id="cfg-mod" label="Modalidades">
          <Textarea id="cfg-mod" rows={5} value={modalities} onChange={(e) => setModalities(e.target.value)} />
        </FormField>
        <FormField id="cfg-lang" label="Idiomas">
          <Textarea id="cfg-lang" rows={5} value={languages} onChange={(e) => setLanguages(e.target.value)} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        <FormField id="cfg-start" label="Abre">
          <Input id="cfg-start" type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
        </FormField>
        <FormField id="cfg-end" label="Cierra">
          <Input id="cfg-end" type="time" value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
        </FormField>
        <FormField id="cfg-daily" label="Sesiones/día">
          <Input id="cfg-daily" type="number" min={1} max={20} value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} />
        </FormField>
        <FormField id="cfg-cons" label="Seguidas máx.">
          <Input id="cfg-cons" type="number" min={1} max={20} value={maxConsecutive} onChange={(e) => setMaxConsecutive(e.target.value)} />
        </FormField>
        <FormField id="cfg-tr" label="Desplazamiento (min)">
          <Input id="cfg-tr" type="number" min={0} max={120} value={transfer} onChange={(e) => setTransfer(e.target.value)} />
        </FormField>
      </div>
      <DialogFooter className="flex-wrap gap-2 sm:justify-between">
        <Button type="button" variant="ghost" className="text-destructive" disabled={deactivate.isPending} onClick={() => deactivate.mutate({ siteId: ctx.siteId })}>
          Desactivar la escuela
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Guardar
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

type PlanSession = { id: number; startTime: string; endTime: string; productName: string; enrolled: number; capacity: number; level: string | null; status: string; instructorName: string | null };

function SessionChip({ ctx, s, onOpen }: { ctx: SkiCtx; s: PlanSession; onOpen: (s: PlanSession) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(s)}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex flex-wrap items-center justify-between gap-1">
        <span className="text-sm font-medium text-foreground">
          {s.startTime}–{s.endTime}
        </span>
        <Badge variant={statusVariant(s.status)}>{STATUS_LABEL[s.status]}</Badge>
      </span>
      <span className="block break-words text-xs text-muted-foreground">
        {s.productName} · {s.enrolled}/{s.capacity}
        {s.level ? ` · ${labelOf(ctx.config.levels, s.level)}` : ""}
      </span>
    </button>
  );
}

function PlanningBody({ ctx, date }: { ctx: SkiCtx; date: string }) {
  const q = trpc.skiSchool.planning.useQuery({ siteId: ctx.siteId, date });
  const [open, setOpen] = useState<PlanSession | null>(null);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data!;
  if (p.instructors.length === 0 && p.unassigned.length === 0)
    return (
      <PanelEmpty icon={<UserPlus className="h-5 w-5" />} title="Da de alta tu primer profesor" description="El planning muestra a cada profesor con sus sesiones del día. Empieza por el equipo y los productos docentes.">
        <Button asChild>
          <Link href="/admin/ski/profesores">Ir a profesores</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/admin/ski/productos-docentes">Productos docentes</Link>
        </Button>
      </PanelEmpty>
    );
  return (
    <>
      {p.unassigned.length > 0 && (
        <section className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-foreground">Sin profesor ({p.unassigned.length})</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {p.unassigned.map((s) => (
              <SessionChip key={s.id} ctx={ctx} s={s} onOpen={setOpen} />
            ))}
          </div>
        </section>
      )}
      {p.instructors.length === 0 ? (
        <PanelEmpty icon={<UserPlus className="h-5 w-5" />} title="Da de alta tu primer profesor" description="Hay sesiones sin profesor y ningún profesor activo en esta sede.">
          <Button asChild>
            <Link href="/admin/ski/profesores">Ir a profesores</Link>
          </Button>
        </PanelEmpty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {p.instructors.map((i) => (
            <section key={i.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold text-foreground">{i.fullName}</h3>
                {!i.active && <Badge variant="secondary">De baja</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{i.weeklyToday.length ? `Disponible ${i.weeklyToday.map((w) => `${w.start}–${w.end}`).join(", ")}` : "Disponible en el horario de la escuela"}</p>
              {i.absences.map((a) => (
                <p key={a.id} className="flex items-center gap-1.5 text-xs text-destructive">
                  <CalendarOff className="h-3.5 w-3.5" aria-hidden="true" />
                  {a.kind === "day_off" ? "Ausente todo el día" : `Bloqueo ${a.startTime}–${a.endTime}`}
                  {a.reason ? ` · ${a.reason}` : ""}
                </p>
              ))}
              {i.sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin sesiones este día.</p>
              ) : (
                <div className="space-y-2">
                  {i.sessions.map((s) => (
                    <SessionChip key={s.id} ctx={ctx} s={s} onOpen={setOpen} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {p.unassigned.length === 0 && p.instructors.every((i) => i.sessions.length === 0) && (
        <p className="text-sm text-muted-foreground">
          No hay sesiones este día.{" "}
          <Link href="/admin/ski/sesiones" className="font-medium text-primary underline-offset-4 hover:underline">
            Crea una sesión
          </Link>
          .
        </p>
      )}
      <SkiSessionDialog ctx={ctx} sessionId={open?.id ?? null} title={open ? `${open.productName} · ${open.startTime}–${open.endTime}` : undefined} onClose={() => setOpen(null)} />
    </>
  );
}

export default function SkiSchoolPlanning() {
  const [date, setDate] = useState(todayIso());
  const [config, setConfig] = useState(false);
  return (
    <SkiSchoolShell
      title="Escuela: planning"
      description="Profesores y sesiones del día. Abre una sesión para inscribir alumnos o asignar profesor."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button variant="outline" onClick={() => setConfig(true)}>
            <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Configuración
          </Button>
        )
      }
    >
      {(ctx) => (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Día anterior" onClick={() => setDate(addDays(date, -1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Input type="date" aria-label="Día" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <Button variant="outline" size="icon" aria-label="Día siguiente" onClick={() => setDate(addDays(date, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDate(todayIso())}>
              Hoy
            </Button>
            <span className="text-sm text-muted-foreground">{formatDay(date)}</span>
          </div>
          <PlanningBody ctx={ctx} date={date} />
          <Dialog open={config} onOpenChange={setConfig}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Configuración de la escuela</DialogTitle>
                <DialogDescription>Propia de esta sede. Parte de una plantilla (niveles A–D, esquí y snowboard) que puedes cambiar.</DialogDescription>
              </DialogHeader>
              {config && <ConfigForm ctx={ctx} onClose={() => setConfig(false)} />}
            </DialogContent>
          </Dialog>
        </>
      )}
    </SkiSchoolShell>
  );
}
