/**
 * Life Net · Agenda del hogar (/admin/life/agenda): calendario de la familia por semanas, con actividades y compromisos
 * de uno o varios miembros (actividades compartidas), lugar, horario y recordatorio por correo a los participantes con
 * acceso. Filtro por miembro. Quitar una actividad la archiva (no se borra).
 */
import { useMemo, useState } from "react";
import { Archive, BellRing, CalendarDays, ChevronLeft, ChevronRight, MapPin, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { EVENT_KINDS, EVENT_KIND_LABELS, addDays, eventProblem, type LifeEventKind } from "@shared/lifeNet";
import { LifeGate, MemberChips, MemberPicker, PageHeader, fmtDay, fmtStamp, todayLocal, useLife } from "./LifeParts";

interface Form {
  id?: number;
  title: string;
  kind: LifeEventKind;
  notes: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  remindDate: string;
  remindTime: string;
  memberIds: number[];
}

/** Lunes de la semana de una fecha. */
function mondayOf(d: string): string {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
  return addDays(d, wd === 0 ? -6 : 1 - wd);
}

export default function LifeAgenda() {
  const { access, members, canWrite, memberId } = useLife();
  const utils = trpc.useUtils();
  const today = todayLocal();
  const [from, setFrom] = useState(mondayOf(today));
  const [who, setWho] = useState("all");
  const [form, setForm] = useState<Form | null>(null);
  const to = addDays(from, 13);
  const events = trpc.lifeNet.events.useQuery({ from, to, memberId: who === "all" ? null : Number(who) }, { enabled: access.isSuccess, retry: false });
  const refresh = () => {
    void utils.lifeNet.events.invalidate();
    void utils.lifeNet.overview.invalidate();
    void utils.lifeNet.tracking.invalidate();
  };
  const upsert = trpc.lifeNet.upsertEvent.useMutation({ onSuccess: () => { toast.success("Actividad guardada"); setForm(null); refresh(); }, onError: (e) => toastError(e) });
  const archive = trpc.lifeNet.archiveEvent.useMutation({ onSuccess: () => { toast.success("Actividad quitada"); refresh(); }, onError: (e) => toastError(e) });
  const list = members.data ?? [];
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(from, i)), [from]);
  const byDay = new Map<string, NonNullable<typeof events.data>>();
  for (const e of events.data ?? []) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  const blank = (date: string): Form => ({ title: "", kind: "actividad", notes: "", location: "", date, startTime: "", endTime: "", remindDate: "", remindTime: "", memberIds: memberId ? [memberId] : [] });
  const save = () => {
    if (!form) return;
    const v = { title: form.title, date: form.date, startTime: form.startTime || null, endTime: form.endTime || null, remindDate: form.remindDate || null, remindTime: form.remindTime || null, memberIds: form.memberIds };
    const p = eventProblem(v);
    if (p) return toast.error(p);
    upsert.mutate({ id: form.id, kind: form.kind, notes: form.notes || null, location: form.location || null, ...v });
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <LifeGate q={access}>
          <PageHeader
            title="Agenda del hogar"
            description="La agenda de toda la familia en un solo calendario: actividades y compromisos de cada miembro o compartidos."
            actions={canWrite ? <Button onClick={() => setForm(blank(today))}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva actividad</Button> : undefined}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="outline" aria-label="Semana anterior" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
              <Button size="sm" variant="outline" onClick={() => setFrom(mondayOf(today))}>Hoy</Button>
              <Button size="icon" variant="outline" aria-label="Semana siguiente" onClick={() => setFrom(addDays(from, 7))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            </div>
            <p className="text-sm text-muted-foreground">{fmtDay(from)} – {fmtDay(to)}</p>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger className="w-full sm:ml-auto sm:w-56" aria-label="Miembro"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el hogar</SelectItem>
                {list.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.displayName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {events.isLoading ? (
            <PanelLoading label="Cargando la agenda…" />
          ) : events.isError ? (
            <PanelError error={events.error} onRetry={() => events.refetch()} />
          ) : (
            <ol className="space-y-2">
              {days.map((d) => {
                const items = byDay.get(d) ?? [];
                return (
                  <li key={d} className={`min-w-0 rounded-xl border bg-card p-3 ${d === today ? "border-primary/50" : "border-border"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold capitalize text-foreground">{fmtDay(d, true)}{d === today ? " · hoy" : ""}</h2>
                      {canWrite && <Button size="sm" variant="ghost" aria-label={`Añadir actividad el ${fmtDay(d)}`} onClick={() => setForm(blank(d))}><Plus className="h-4 w-4" aria-hidden="true" /></Button>}
                    </div>
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin actividades.</p>
                    ) : (
                      <ul className="mt-1 divide-y divide-border">
                        {items.map((e) => (
                          <li key={e.id} className="flex min-w-0 flex-col gap-1.5 py-2 sm:flex-row sm:items-start">
                            <div className="min-w-0 flex-1 space-y-1">
                              <p className="break-words text-sm font-medium text-foreground">
                                <span className="mr-2 tabular-nums text-muted-foreground">{e.startTime ? `${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : "Todo el día"}</span>
                                {e.title}
                              </p>
                              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                                <span>{EVENT_KIND_LABELS[e.kind]}</span>
                                {e.location && <span className="inline-flex min-w-0 items-center gap-1 break-words"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />{e.location}</span>}
                                {e.remindAt && <span className="inline-flex items-center gap-1"><BellRing className="h-3 w-3" aria-hidden="true" />{fmtStamp(e.remindAt)}</span>}
                              </p>
                              {e.notes && <p className="break-words text-xs text-muted-foreground">{e.notes}</p>}
                              <MemberChips ids={e.memberIds} members={list} />
                            </div>
                            {canWrite && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Editar ${e.title}`}
                                  onClick={() => setForm({ id: e.id, title: e.title, kind: e.kind, notes: e.notes ?? "", location: e.location ?? "", date: e.date, startTime: e.startTime ?? "", endTime: e.endTime ?? "", remindDate: e.remindAt?.slice(0, 10) ?? "", remindTime: e.remindAt?.slice(11, 16) ?? "", memberIds: e.memberIds })}
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </Button>
                                <Button size="sm" variant="ghost" aria-label={`Quitar ${e.title}`} onClick={() => archive.mutate({ id: e.id })}><Archive className="h-4 w-4" aria-hidden="true" /></Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />Se muestran dos semanas. Usa las flechas para moverte.</p>
        </LifeGate>
      </div>

      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar actividad" : "Nueva actividad"}</DialogTitle>
            <DialogDescription>Elige quién participa. El recordatorio llega por correo a los participantes con acceso.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="life-e-title">Nombre</Label>
                <Input id="life-e-title" maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-kind">Tipo</Label>
                  <Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as LifeEventKind })}>
                    <SelectTrigger id="life-e-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>{EVENT_KINDS.map((k) => <SelectItem key={k} value={k}>{EVENT_KIND_LABELS[k]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-date">Fecha</Label>
                  <Input id="life-e-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-start">Empieza (opcional)</Label>
                  <Input id="life-e-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-end">Termina (opcional)</Label>
                  <Input id="life-e-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} />
                </div>
              </div>
              <MemberPicker legend="Quién participa" members={list} value={form.memberIds} onChange={(memberIds) => setForm({ ...form, memberIds })} />
              <div className="space-y-1.5">
                <Label htmlFor="life-e-loc">Lugar (opcional)</Label>
                <Input id="life-e-loc" maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-rdate">Recordatorio: día</Label>
                  <Input id="life-e-rdate" type="date" value={form.remindDate} onChange={(e) => setForm({ ...form, remindDate: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="life-e-rtime">Recordatorio: hora</Label>
                  <Input id="life-e-rtime" type="time" value={form.remindTime} onChange={(e) => setForm({ ...form, remindTime: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="life-e-notes">Notas (opcional)</Label>
                <Textarea id="life-e-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button disabled={upsert.isPending} onClick={save}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
