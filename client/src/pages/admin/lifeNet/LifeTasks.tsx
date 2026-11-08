/**
 * Life Net · Tareas y recordatorios (/admin/life/tareas): tareas del hogar con uno o varios responsables, fecha límite
 * y recordatorio por correo (a los responsables con acceso). Marcar como hecha guarda quién y cuándo; la administración
 * puede marcarla en nombre de otro miembro. Quitar una tarea la archiva (no se borra).
 */
import { useState } from "react";
import { Archive, BellRing, CheckCircle2, ListTodo, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelLoading, PanelError, toastError } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { taskProblem } from "@shared/lifeNet";
import { LifeGate, MemberChips, MemberPicker, PageHeader, TaskStateBadge, fmtDay, fmtMs, fmtStamp, useLife } from "./LifeParts";

interface Form {
  id?: number;
  title: string;
  notes: string;
  dueDate: string;
  dueTime: string;
  remindDate: string;
  remindTime: string;
  assigneeIds: number[];
}
const empty = (memberId: number | null): Form => ({ title: "", notes: "", dueDate: "", dueTime: "", remindDate: "", remindTime: "", assigneeIds: memberId ? [memberId] : [] });

export default function LifeTasks() {
  const { access, members, canWrite, isAdmin, memberId } = useLife();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<"open" | "done">("open");
  const [who, setWho] = useState<string>("all");
  const [form, setForm] = useState<Form | null>(null);
  const [doneFor, setDoneFor] = useState<{ id: number; by: string } | null>(null);
  const tasks = trpc.lifeNet.tasks.useQuery({ status, memberId: who === "all" ? null : Number(who) }, { enabled: access.isSuccess, retry: false });
  const refresh = () => {
    void utils.lifeNet.tasks.invalidate();
    void utils.lifeNet.overview.invalidate();
    void utils.lifeNet.tracking.invalidate();
  };
  const upsert = trpc.lifeNet.upsertTask.useMutation({ onSuccess: () => { toast.success("Tarea guardada"); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const setDone = trpc.lifeNet.setTaskDone.useMutation({ onSuccess: (_r, v) => { toast.success(v.done ? "Tarea hecha" : "Tarea reabierta"); setDoneFor(null); refresh(); }, onError: (e) => toastError(e) });
  const archive = trpc.lifeNet.archiveTask.useMutation({ onSuccess: () => { toast.success("Tarea quitada"); refresh(); }, onError: (e) => toastError(e) });
  const list = members.data ?? [];
  const byId = new Map(list.map((m) => [m.id, m] as const));

  const save = () => {
    if (!form) return;
    const v = { title: form.title, dueDate: form.dueDate || null, dueTime: form.dueTime || null, remindDate: form.remindDate || null, remindTime: form.remindTime || null };
    const p = taskProblem(v);
    if (p) return toast.error(p);
    upsert.mutate({ id: form.id, notes: form.notes || null, assigneeIds: form.assigneeIds, ...v });
  };
  const markDone = (id: number) => {
    // La administración elige quién la hizo; un miembro la marca como suya
    if (isAdmin) setDoneFor({ id, by: memberId ? String(memberId) : list[0] ? String(list[0].id) : "" });
    else setDone.mutate({ id, done: true });
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <LifeGate q={access}>
          <PageHeader
            title="Tareas y recordatorios"
            description="Lo que hay que hacer en casa, quién se encarga y para cuándo. Si pones un recordatorio, avisamos por correo a los responsables con acceso."
            actions={canWrite ? <Button onClick={() => setForm(empty(memberId))}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva tarea</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Estado" className="inline-flex rounded-lg border border-border p-0.5">
              {(["open", "done"] as const).map((s) => (
                <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={cn("rounded-md px-3 py-1.5 text-sm", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {s === "open" ? "Abiertas" : "Hechas"}
                </button>
              ))}
            </div>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Miembro"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el hogar</SelectItem>
                {list.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {tasks.isLoading ? (
            <PanelLoading label="Cargando las tareas…" />
          ) : tasks.isError ? (
            <PanelError error={tasks.error} onRetry={() => tasks.refetch()} />
          ) : (tasks.data ?? []).length === 0 ? (
            <PanelEmpty icon={<ListTodo className="h-5 w-5" />} title={status === "open" ? "No hay tareas abiertas" : "Aún no hay tareas hechas"} description={status === "open" ? "Crea una tarea y asígnala a uno o varios miembros del hogar." : "Cuando alguien marque una tarea como hecha, aparecerá aquí con quién y cuándo."}>
              {canWrite && status === "open" && <Button onClick={() => setForm(empty(memberId))}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva tarea</Button>}
            </PanelEmpty>
          ) : (
            <ul className="space-y-2">
              {(tasks.data ?? []).map((t) => (
                <li key={t.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 break-words font-medium text-foreground">{t.title}</p>
                      <TaskStateBadge state={t.state} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t.dueDate ? `Para el ${fmtDay(t.dueDate)}${t.dueTime ? `, ${t.dueTime}` : ""}` : "Sin fecha límite"}
                      {t.remindAt && <span className="ml-2 inline-flex items-center gap-1"><BellRing className="h-3 w-3" aria-hidden="true" />Recordatorio: {fmtStamp(t.remindAt)}</span>}
                    </p>
                    {t.status === "done" && (
                      <p className="text-xs text-muted-foreground">Hecha {t.doneByMemberId && byId.get(t.doneByMemberId) ? `por ${byId.get(t.doneByMemberId)!.displayName}` : ""} el {fmtMs(t.doneAt)}</p>
                    )}
                    {t.notes && <p className="break-words text-xs text-muted-foreground">{t.notes}</p>}
                    <MemberChips ids={t.assigneeIds} members={list} />
                  </div>
                  {canWrite && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.status === "done" ? (
                        <Button size="sm" variant="outline" onClick={() => setDone.mutate({ id: t.id, done: false })}><RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />Reabrir</Button>
                      ) : (
                        <Button size="sm" onClick={() => markDone(t.id)}><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />Hecha</Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Editar ${t.title}`}
                        onClick={() => setForm({ id: t.id, title: t.title, notes: t.notes ?? "", dueDate: t.dueDate ?? "", dueTime: t.dueTime ?? "", remindDate: t.remindAt?.slice(0, 10) ?? "", remindTime: t.remindAt?.slice(11, 16) ?? "", assigneeIds: t.assigneeIds })}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Quitar ${t.title}`} onClick={() => archive.mutate({ id: t.id })}><Archive className="h-4 w-4" aria-hidden="true" /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </LifeGate>
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
            <DialogDescription>Elige a los responsables. El recordatorio llega por correo a los que tienen acceso.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="life-t-title">Qué hay que hacer</Label>
                <Input id="life-t-title" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <MemberPicker legend="Responsables" members={list} value={form.assigneeIds} onChange={(assigneeIds) => setForm({ ...form, assigneeIds })} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="life-t-due">Fecha límite (opcional)</Label>
                  <Input id="life-t-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-t-duetime">Hora límite (opcional)</Label>
                  <Input id="life-t-duetime" type="time" value={form.dueTime} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-t-rdate">Recordatorio: día</Label>
                  <Input id="life-t-rdate" type="date" value={form.remindDate} onChange={(e) => setForm({ ...form, remindDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-t-rtime">Recordatorio: hora</Label>
                  <Input id="life-t-rtime" type="time" value={form.remindTime} onChange={(e) => setForm({ ...form, remindTime: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="life-t-notes">Notas (opcional)</Label>
                <Textarea id="life-t-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={upsert.isPending} onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={doneFor != null} onOpenChange={(o) => !o && setDoneFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Quién la ha hecho?</DialogTitle>
            <DialogDescription>Queda guardado quién la hizo y cuándo, para el seguimiento del hogar.</DialogDescription>
          </DialogHeader>
          {doneFor && (
            <Select value={doneFor.by} onValueChange={(by) => setDoneFor({ ...doneFor, by })}>
              <SelectTrigger aria-label="Miembro que la hizo"><SelectValue placeholder="Elige un miembro" /></SelectTrigger>
              <SelectContent>
                {list.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDoneFor(null)}>Cancelar</Button>
            <Button disabled={setDone.isPending || !doneFor} onClick={() => doneFor && setDone.mutate({ id: doneFor.id, done: true, doneByMemberId: doneFor.by ? Number(doneFor.by) : null })}>Marcar como hecha</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
