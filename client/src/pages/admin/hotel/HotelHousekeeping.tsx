import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Play, RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { EmptyStep, PmsNotInstalled, ROOM_STATE_LABEL, addDays, isPmsNotInstalled, localToday, roomStateClass, shortDate } from "./pmsShared";

const KIND_LABEL: Record<string, string> = { salida: "Limpieza de salida", repaso: "Repaso", limpieza: "Limpieza" };
const STATUS_LABEL: Record<string, string> = { pendiente: "Pendiente", en_curso: "En curso", hecha: "Hecha", inspeccionada: "Inspeccionada" };
const PRIORITY_LABEL: Record<string, string> = { baja: "Baja", media: "Media", alta: "Alta" };
const INCIDENT_LABEL: Record<string, string> = { abierta: "Abierta", en_curso: "En curso", resuelta: "Resuelta" };

function statusClass(s: string) {
  if (s === "inspeccionada") return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (s === "hecha") return "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300";
  if (s === "en_curso") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}

type Task = {
  id: number; hotelRoomId: number; kind: string; status: string; assignedUserId: number | null; assignedName: string | null;
  notes: string | null; roomCode: string; roomFloor: string | null; roomStatus: string; roomTypeName: string | null;
};

/** Tarjeta de tarea: botones grandes para el móvil; quien gestiona además asigna e inspecciona. */
function TaskCard({ t, canManage, assignees, onChanged, onIncident }: {
  t: Task; canManage: boolean; assignees?: Array<{ id: number; name: string }>; onChanged: () => void; onIncident: (t: Task) => void;
}) {
  const setStatus = trpc.hotel.hkSetTaskStatus.useMutation({ onSuccess: () => { toast.success("Tarea actualizada"); onChanged(); }, onError: (e) => toast.error(e.message) });
  const assign = trpc.hotel.adminHkAssignTask.useMutation({ onSuccess: () => { toast.success("Tarea asignada"); onChanged(); }, onError: (e) => toast.error(e.message) });
  const go = (to: "pendiente" | "en_curso" | "hecha" | "inspeccionada") => setStatus.mutate({ taskId: t.id, to });
  const busy = setStatus.isPending || assign.isPending;
  return (
    <div className="rounded-lg border border-border p-3 space-y-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-base">{t.roomCode}{t.roomFloor ? <span className="text-xs text-muted-foreground font-normal"> · planta {t.roomFloor}</span> : null}</div>
          <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{KIND_LABEL[t.kind] ?? t.kind}{t.roomTypeName ? ` · ${t.roomTypeName}` : ""}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className={statusClass(t.status)}>{STATUS_LABEL[t.status] ?? t.status}</Badge>
          <Badge variant="outline" className={`text-[10px] ${roomStateClass(t.roomStatus)}`}>{ROOM_STATE_LABEL[t.roomStatus] ?? t.roomStatus}</Badge>
        </div>
      </div>
      {t.notes && <p className="text-xs text-muted-foreground">{t.notes}</p>}
      {canManage && assignees && (
        <Select value={t.assignedUserId ? String(t.assignedUserId) : "none"} onValueChange={(v) => assign.mutate({ taskId: t.id, assignedUserId: v === "none" ? null : Number(v) })} disabled={busy || t.status === "inspeccionada"}>
          <SelectTrigger className="h-9" aria-label="Persona asignada"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sin asignar</SelectItem>
            {assignees.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {!canManage && t.assignedName && <p className="text-xs text-muted-foreground">Asignada a {t.assignedName}</p>}
      <div className="flex flex-wrap gap-2">
        {t.status === "pendiente" && <Button className="h-10 flex-1 min-w-[120px]" variant="secondary" onClick={() => go("en_curso")} disabled={busy}><Play className="h-4 w-4 mr-1" /> Empezar</Button>}
        {(t.status === "pendiente" || t.status === "en_curso") && <Button className="h-10 flex-1 min-w-[120px]" onClick={() => go("hecha")} disabled={busy}><CheckCircle2 className="h-4 w-4 mr-1" /> Hecha</Button>}
        {t.status === "hecha" && canManage && <Button className="h-10 flex-1 min-w-[120px]" onClick={() => go("inspeccionada")} disabled={busy}><ClipboardCheck className="h-4 w-4 mr-1" /> Inspeccionar</Button>}
        {t.status === "hecha" && <Button className="h-10" variant="outline" onClick={() => go("en_curso")} disabled={busy}>Reabrir</Button>}
        <Button className="h-10" variant="ghost" onClick={() => onIncident(t)} title="Avisar de una incidencia"><AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /><span className="sr-only">Incidencia</span></Button>
      </div>
    </div>
  );
}

function IncidentDialog({ rooms, defaultRoomId, onClose, onDone }: { rooms: Array<{ id: number; code: string }>; defaultRoomId: number | null; onClose: () => void; onDone: () => void }) {
  const typesQ = trpc.hotel.hkIncidentTypes.useQuery();
  const [roomId, setRoomId] = useState<number | null>(defaultRoomId ?? rooms[0]?.id ?? null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [priority, setPriority] = useState<"baja" | "media" | "alta">("media");
  const [blocks, setBlocks] = useState(false);
  const [desc, setDesc] = useState("");
  const report = trpc.hotel.hkReportIncident.useMutation({ onSuccess: () => { toast.success("Incidencia registrada"); onDone(); onClose(); }, onError: (e) => toast.error(e.message) });
  const types = typesQ.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nueva incidencia</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Habitación</Label>
            <Select value={roomId ? String(roomId) : ""} onValueChange={(v) => setRoomId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Habitación" /></SelectTrigger>
              <SelectContent>{rooms.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.code}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Tipo</Label>
            <Select value={typeId ? String(typeId) : ""} onValueChange={(v) => setTypeId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Elige el tipo" /></SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Prioridad</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="baja">Baja</SelectItem><SelectItem value="media">Media</SelectItem><SelectItem value="alta">Alta</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Descripción</Label><Textarea rows={3} maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Switch checked={blocks} onCheckedChange={setBlocks} /> Bloquear la habitación hasta resolverla</label>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!roomId || !typeId || report.isPending} onClick={() => roomId && typeId && report.mutate({ hotelRoomId: roomId, typeId, description: desc.trim() || undefined, priority, blocksRoom: blocks })}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncidentsPanel({ onReport }: { onReport: () => void }) {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<"abiertas" | "resuelta">("abiertas");
  const q = trpc.hotel.adminHkIncidents.useQuery({ status: filter });
  const setStatus = trpc.hotel.adminHkSetIncidentStatus.useMutation({
    onSuccess: () => { toast.success("Incidencia actualizada"); void utils.hotel.adminHkIncidents.invalidate(); void utils.hotel.adminHkTasks.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const list = q.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="abiertas">Abiertas y en curso</SelectItem><SelectItem value="resuelta">Resueltas</SelectItem></SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={onReport}><AlertTriangle className="h-4 w-4 mr-1" /> Nueva incidencia</Button>
      </div>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filter === "abiertas" ? "No hay incidencias abiertas." : "Sin incidencias resueltas."}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((i) => (
            <div key={i.id} className="rounded-lg border border-border p-3 space-y-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">Hab. {i.roomCode} · {i.typeName}</div>
                <Badge variant={i.priority === "alta" ? "destructive" : "outline"}>{PRIORITY_LABEL[i.priority] ?? i.priority}</Badge>
              </div>
              {i.description && <p className="text-sm">{i.description}</p>}
              <p className="text-xs text-muted-foreground">{INCIDENT_LABEL[i.status] ?? i.status}{i.blocksRoom ? " · bloquea la habitación" : ""}{i.reporter ? ` · ${i.reporter}` : ""} · {new Date(i.createdAt).toLocaleString("es-ES")}</p>
              {i.status !== "resuelta" && (
                <div className="flex gap-2 pt-1">
                  {i.status === "abierta" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ id: i.id, status: "en_curso" })} disabled={setStatus.isPending}>En curso</Button>}
                  <Button size="sm" onClick={() => setStatus.mutate({ id: i.id, status: "resuelta" })} disabled={setStatus.isPending}>Resolver</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IncidentTypesPanel() {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminHkIncidentTypes.useQuery();
  const [name, setName] = useState("");
  const save = trpc.hotel.adminHkSaveIncidentType.useMutation({
    onSuccess: () => { toast.success("Tipo guardado"); setName(""); void utils.hotel.adminHkIncidentTypes.invalidate(); void utils.hotel.hkIncidentTypes.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input className="w-64" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nuevo tipo (p. ej. Caja fuerte)" />
        <Button size="sm" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate({ name })}>Añadir</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(q.data ?? []).map((t) => (
          <label key={t.id} className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm ${t.isActive ? "" : "opacity-60"}`}>
            <Switch checked={t.isActive} onCheckedChange={(v) => save.mutate({ id: t.id, name: t.name, isActive: v })} aria-label={`Activar ${t.name}`} /> {t.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function HotelHousekeeping() {
  const utils = trpc.useUtils();
  const [date, setDate] = useState(localToday());
  const [incidentFor, setIncidentFor] = useState<{ roomId: number | null } | null>(null);
  const [person, setPerson] = useState("all");
  const meQ = trpc.hotel.hkMyTasks.useQuery({ date }, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const canManage = !!meQ.data?.canManage;
  const allQ = trpc.hotel.adminHkTasks.useQuery({ date }, { enabled: canManage, retry: false });
  const assigneesQ = trpc.hotel.adminHkAssignees.useQuery(undefined, { enabled: canManage });
  const roomsQ = trpc.hotel.adminGetRooms.useQuery(undefined, { enabled: canManage, retry: false });
  const generate = trpc.hotel.adminHkGenerateTasks.useMutation({
    onSuccess: (r) => { toast.success(r.created ? `${r.created} tareas creadas` : "No había tareas nuevas que crear"); refresh(); },
    onError: (e) => toast.error(e.message),
  });
  const refresh = () => { void utils.hotel.hkMyTasks.invalidate(); void utils.hotel.adminHkTasks.invalidate(); void utils.hotel.adminGetRooms.invalidate(); };

  const mine = (meQ.data?.tasks ?? []) as Task[];
  const all = (allQ.data ?? []) as Task[];
  const shown = useMemo(() => (person === "all" ? all : person === "none" ? all.filter((t) => !t.assignedUserId) : all.filter((t) => String(t.assignedUserId) === person)), [all, person]);
  const counts = useMemo(() => ({ total: all.length, done: all.filter((t) => t.status === "hecha" || t.status === "inspeccionada").length, unassigned: all.filter((t) => !t.assignedUserId).length }), [all]);
  const incidentRooms = canManage
    ? (roomsQ.data ?? []).map((r: any) => ({ id: r.id as number, code: r.code as string }))
    : Array.from(new Map(mine.map((t) => [t.hotelRoomId, { id: t.hotelRoomId, code: t.roomCode }])).values());

  const dateBar = (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior"><ChevronLeft className="h-4 w-4" /></Button>
      <Input type="date" className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Día" />
      <Button variant="outline" size="icon" onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente"><ChevronRight className="h-4 w-4" /></Button>
      <Button variant="outline" size="icon" onClick={refresh} aria-label="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
    </div>
  );

  const myList = mine.length === 0 ? (
    <EmptyStep title="No tienes tareas para este día" text={canManage ? "Asígnate tareas en «Tareas del día»." : "Cuando recepción te asigne habitaciones, aparecerán aquí."} />
  ) : (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {mine.map((t) => <TaskCard key={t.id} t={t} canManage={false} onChanged={refresh} onIncident={(x) => setIncidentFor({ roomId: x.hotelRoomId })} />)}
    </div>
  );

  return (
    <AdminLayout title="Housekeeping">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><Sparkles className="h-6 w-6 shrink-0" /> Housekeeping</h1>
            <p className="text-muted-foreground text-sm">Limpieza y estado de las habitaciones del {shortDate(date)}. Cada cambio actualiza el estado de la habitación para recepción.</p>
          </div>
          {dateBar}
        </div>

        {isPmsNotInstalled(meQ.error) ? (
          <PmsNotInstalled />
        ) : meQ.isLoading ? (
          <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div>
        ) : meQ.error ? (
          <Card><CardContent className="p-6 text-sm text-destructive">{meQ.error.message}</CardContent></Card>
        ) : !canManage ? (
          <>
            {myList}
            <Button variant="outline" onClick={() => setIncidentFor({ roomId: null })} disabled={!incidentRooms.length}><AlertTriangle className="h-4 w-4 mr-1" /> Avisar de una incidencia</Button>
          </>
        ) : (
          <Tabs defaultValue="dia">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="dia">Tareas del día</TabsTrigger>
              <TabsTrigger value="mias">Mis tareas</TabsTrigger>
              <TabsTrigger value="incidencias">Incidencias</TabsTrigger>
              <TabsTrigger value="tipos">Tipos de incidencia</TabsTrigger>
            </TabsList>
            <TabsContent value="dia" className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => generate.mutate({ date })} disabled={generate.isPending}><Wand2 className="h-4 w-4 mr-1" /> Generar tareas del día</Button>
                <Select value={person} onValueChange={setPerson}>
                  <SelectTrigger className="w-48" aria-label="Filtrar por persona"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas las personas</SelectItem>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {(assigneesQ.data ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">{counts.done} de {counts.total} hechas · {counts.unassigned} sin asignar</span>
              </div>
              {allQ.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : all.length === 0 ? (
                <Card><CardContent className="p-0"><EmptyStep title="Sin tareas para este día" text="Pulsa «Generar tareas del día»: limpieza de salida para las habitaciones con salida, repaso para las ocupadas y limpieza para las sucias." /></CardContent></Card>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {shown.map((t) => <TaskCard key={t.id} t={t} canManage assignees={assigneesQ.data ?? []} onChanged={refresh} onIncident={(x) => setIncidentFor({ roomId: x.hotelRoomId })} />)}
                </div>
              )}
            </TabsContent>
            <TabsContent value="mias" className="pt-2">{myList}</TabsContent>
            <TabsContent value="incidencias" className="pt-2"><IncidentsPanel onReport={() => setIncidentFor({ roomId: null })} /></TabsContent>
            <TabsContent value="tipos" className="pt-2">
              <Card><CardHeader className="pb-2"><CardTitle className="text-base">Tipos de incidencia</CardTitle></CardHeader><CardContent><IncidentTypesPanel /></CardContent></Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
      {incidentFor && (
        <IncidentDialog
          rooms={incidentRooms}
          defaultRoomId={incidentFor.roomId}
          onClose={() => setIncidentFor(null)}
          onDone={() => { refresh(); void utils.hotel.adminHkIncidents.invalidate(); }}
        />
      )}
    </AdminLayout>
  );
}
