/**
 * Ski Net · Escuela — Profesores (/admin/ski/profesores): alta y ficha (modalidades, niveles, idiomas y edades
 * que enseña), disponibilidad semanal y ausencias por periodo. Nada se borra: un profesor se da de baja (archiva).
 */
import { useState } from "react";
import { CalendarOff, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { CodeToggles, SkiSchoolShell, WEEKDAYS, addDays, labelOf, todayIso, toastSki, type SkiCtx } from "@/components/ski/SkiSchoolShell";

type Weekly = { day: number; start: string; end: string };
type InstructorRow = {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  modalities: string[];
  levels: string[];
  languages: string[];
  minAge: number | null;
  maxAge: number | null;
  weekly: Weekly[];
  notes: string | null;
  active: boolean;
};

const ageOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

function InstructorForm({ ctx, row, onClose }: { ctx: SkiCtx; row: InstructorRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [fullName, setFullName] = useState(row?.fullName ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [phone, setPhone] = useState(row?.phone ?? "");
  const [modalities, setModalities] = useState<string[]>(row?.modalities ?? []);
  const [levels, setLevels] = useState<string[]>(row?.levels ?? []);
  const [languages, setLanguages] = useState<string[]>(row?.languages ?? []);
  const [minAge, setMinAge] = useState(row?.minAge?.toString() ?? "");
  const [maxAge, setMaxAge] = useState(row?.maxAge?.toString() ?? "");
  const [weekly, setWeekly] = useState<Weekly[]>(row?.weekly ?? []);
  const [notes, setNotes] = useState(row?.notes ?? "");
  const done = (msg: string) => {
    toast.success(msg);
    utils.skiSchool.listInstructors.invalidate();
    utils.skiSchool.planning.invalidate();
    onClose();
  };
  const create = trpc.skiSchool.createInstructor.useMutation({ onSuccess: () => done("Profesor dado de alta"), onError: toastSki });
  const update = trpc.skiSchool.updateInstructor.useMutation({ onSuccess: () => done("Ficha guardada"), onError: toastSki });
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = { siteId: ctx.siteId, fullName, email: email || null, phone: phone || null, modalities, levels, languages, minAge: ageOrNull(minAge), maxAge: ageOrNull(maxAge), weekly, notes: notes || null };
    if (row) update.mutate({ ...data, instructorId: row.id });
    else create.mutate(data);
  };
  const setSlot = (i: number, patch: Partial<Weekly>) => setWeekly(weekly.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="ins-name" label="Nombre" required>
          <Input id="ins-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required />
        </FormField>
        <FormField id="ins-email" label="Correo">
          <Input id="ins-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} />
        </FormField>
        <FormField id="ins-phone" label="Teléfono">
          <Input id="ins-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="ins-min" label="Edad mínima">
            <Input id="ins-min" type="number" min={0} max={120} value={minAge} onChange={(e) => setMinAge(e.target.value)} />
          </FormField>
          <FormField id="ins-max" label="Edad máxima">
            <Input id="ins-max" type="number" min={0} max={120} value={maxAge} onChange={(e) => setMaxAge(e.target.value)} />
          </FormField>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Modalidades</p>
        <CodeToggles label="Modalidades" options={ctx.config.modalities} value={modalities} onChange={setModalities} />
        <p className="text-xs text-muted-foreground">Sin marcar ninguna, puede dar cualquier modalidad.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Niveles que imparte</p>
        <CodeToggles label="Niveles" options={ctx.config.levels} value={levels} onChange={setLevels} />
        <p className="text-xs text-muted-foreground">Sin marcar ninguno, puede dar cualquier nivel.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">Idiomas</p>
        <CodeToggles label="Idiomas" options={ctx.config.languages} value={languages} onChange={setLanguages} />
        <p className="text-xs text-muted-foreground">El primero que marques es su idioma principal.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Disponibilidad semanal</legend>
        <p className="text-xs text-muted-foreground">Sin franjas, se considera disponible en todo el horario de la escuela ({ctx.config.dayStart}–{ctx.config.dayEnd}).</p>
        {weekly.map((w, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select aria-label="Día" className={`${selectClass} w-36`} value={w.day} onChange={(e) => setSlot(i, { day: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <option key={d} value={d}>
                  {WEEKDAYS[d]}
                </option>
              ))}
            </select>
            <Input aria-label="Desde" type="time" className="w-28" value={w.start} onChange={(e) => setSlot(i, { start: e.target.value })} />
            <Input aria-label="Hasta" type="time" className="w-28" value={w.end} onChange={(e) => setSlot(i, { end: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" aria-label="Quitar franja" onClick={() => setWeekly(weekly.filter((_, j) => j !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setWeekly([...weekly, { day: 1, start: ctx.config.dayStart, end: ctx.config.dayEnd }])}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Añadir franja
        </Button>
      </fieldset>
      <FormField id="ins-notes" label="Notas">
        <Textarea id="ins-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
      </FormField>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {row ? "Guardar" : "Dar de alta"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Absences({ ctx, row }: { ctx: SkiCtx; row: InstructorRow }) {
  const utils = trpc.useUtils();
  const from = todayIso();
  const list = trpc.skiSchool.listAbsences.useQuery({ siteId: ctx.siteId, from, to: addDays(from, 365), instructorId: row.id });
  const [startDate, setStartDate] = useState(from);
  const [endDate, setEndDate] = useState(from);
  const [kind, setKind] = useState<"day_off" | "partial_block">("day_off");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("11:00");
  const [reason, setReason] = useState("");
  const refresh = () => {
    utils.skiSchool.listAbsences.invalidate();
    utils.skiSchool.planning.invalidate();
  };
  const add = trpc.skiSchool.addAbsence.useMutation({
    onSuccess: () => {
      toast.success("Ausencia registrada");
      setReason("");
      refresh();
    },
    onError: toastSki,
  });
  const cancel = trpc.skiSchool.cancelAbsence.useMutation({ onSuccess: () => (toast.success("Ausencia anulada"), refresh()), onError: toastSki });

  return (
    <div className="space-y-4">
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : list.data!.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin ausencias en los próximos doce meses.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.data!.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 break-words">
                {a.startDate === a.endDate ? a.startDate : `${a.startDate} → ${a.endDate}`} · {a.kind === "day_off" ? "Día completo" : `${a.startTime}–${a.endTime}`}
                {a.reason ? ` · ${a.reason}` : ""}
              </span>
              {ctx.canWrite && (
                <Button type="button" variant="ghost" size="sm" onClick={() => cancel.mutate({ siteId: ctx.siteId, absenceId: a.id })}>
                  Anular
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ctx.canWrite && (
        <form
          className="space-y-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ siteId: ctx.siteId, instructorId: row.id, startDate, endDate, kind, startTime: kind === "partial_block" ? startTime : null, endTime: kind === "partial_block" ? endTime : null, reason: reason || null });
          }}
        >
          <p className="text-sm font-medium text-foreground">Nueva ausencia</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="abs-from" label="Desde">
              <Input id="abs-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </FormField>
            <FormField id="abs-to" label="Hasta">
              <Input id="abs-to" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </FormField>
            <FormField id="abs-kind" label="Tipo">
              <select id="abs-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="day_off">Día completo</option>
                <option value="partial_block">Bloqueo de horas</option>
              </select>
            </FormField>
            {kind === "partial_block" && (
              <>
                <FormField id="abs-st" label="De">
                  <Input id="abs-st" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </FormField>
                <FormField id="abs-et" label="A">
                  <Input id="abs-et" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </FormField>
              </>
            )}
            <FormField id="abs-reason" label="Motivo">
              <Input id="abs-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
            </FormField>
          </div>
          <Button type="submit" size="sm" disabled={add.isPending}>
            Registrar ausencia
          </Button>
        </form>
      )}
    </div>
  );
}

function InstructorsBody({ ctx, onNew }: { ctx: SkiCtx; onNew: () => void }) {
  const utils = trpc.useUtils();
  const list = trpc.skiSchool.listInstructors.useQuery({ siteId: ctx.siteId });
  const [editing, setEditing] = useState<InstructorRow | null>(null);
  const [absences, setAbsences] = useState<InstructorRow | null>(null);
  const toggle = trpc.skiSchool.updateInstructor.useMutation({
    onSuccess: (r) => {
      toast.success(r.active ? "Profesor reactivado" : "Profesor dado de baja");
      utils.skiSchool.listInstructors.invalidate();
    },
    onError: toastSki,
  });

  if (list.isLoading) return <PanelLoading />;
  if (list.error) return <PanelError error={list.error} onRetry={() => list.refetch()} />;
  const rows = list.data as InstructorRow[];
  if (rows.length === 0)
    return (
      <PanelEmpty icon={<UserPlus className="h-5 w-5" />} title="Da de alta tu primer profesor" description="Indica sus modalidades, niveles e idiomas y su disponibilidad semanal para poder asignarle sesiones.">
        {ctx.canWrite && <Button onClick={onNew}>Nuevo profesor</Button>}
      </PanelEmpty>
    );

  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <li key={r.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-semibold text-foreground">{r.fullName}</p>
                {(r.email || r.phone) && <p className="break-all text-xs text-muted-foreground">{[r.email, r.phone].filter(Boolean).join(" · ")}</p>}
              </div>
              {!r.active && <Badge variant="secondary">De baja</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(r.modalities.length ? r.modalities : ["*"]).map((m) => (
                <Badge key={`m-${m}`} variant="outline">
                  {m === "*" ? "Todas las modalidades" : labelOf(ctx.config.modalities, m)}
                </Badge>
              ))}
              {(r.levels.length ? r.levels : ["*"]).map((l) => (
                <Badge key={`l-${l}`} variant="outline">
                  {l === "*" ? "Todos los niveles" : labelOf(ctx.config.levels, l)}
                </Badge>
              ))}
              {r.languages.map((l, i) => (
                <Badge key={`i-${l}`} variant={i === 0 ? "default" : "outline"}>
                  {labelOf(ctx.config.languages, l)}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {r.weekly.length === 0 ? "Disponible en todo el horario de la escuela" : r.weekly.map((w) => `${WEEKDAYS[w.day].slice(0, 3)} ${w.start}–${w.end}`).join(" · ")}
              {r.minAge != null || r.maxAge != null ? ` · Edades ${r.minAge ?? 0}–${r.maxAge ?? "∞"}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              {ctx.canWrite && (
                <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Editar
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setAbsences(r)}>
                <CalendarOff className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Ausencias
              </Button>
              {ctx.canWrite && (
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ siteId: ctx.siteId, instructorId: r.id, active: !r.active })}>
                  {r.active ? "Dar de baja" : "Reactivar"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ficha del profesor</DialogTitle>
            <DialogDescription>Modalidades, niveles, idiomas y disponibilidad que se comprueban al asignarle sesiones.</DialogDescription>
          </DialogHeader>
          {editing && <InstructorForm ctx={ctx} row={editing} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!absences} onOpenChange={(o) => !o && setAbsences(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ausencias de {absences?.fullName}</DialogTitle>
            <DialogDescription>Una ausencia impide asignarle sesiones en ese periodo o franja.</DialogDescription>
          </DialogHeader>
          {absences && <Absences ctx={ctx} row={absences} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function SkiInstructors() {
  const [creating, setCreating] = useState(false);
  return (
    <SkiSchoolShell
      title="Profesores"
      description="Profesores y monitores de la escuela en esta sede, con lo que pueden enseñar y cuándo están disponibles."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nuevo profesor
          </Button>
        )
      }
    >
      {(ctx) => (
        <>
          <InstructorsBody ctx={ctx} onNew={() => setCreating(true)} />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nuevo profesor</DialogTitle>
                <DialogDescription>Datos ficticios o reales de tu equipo: solo los ve la administración de la empresa.</DialogDescription>
              </DialogHeader>
              {creating && <InstructorForm ctx={ctx} row={null} onClose={() => setCreating(false)} />}
            </DialogContent>
          </Dialog>
        </>
      )}
    </SkiSchoolShell>
  );
}
