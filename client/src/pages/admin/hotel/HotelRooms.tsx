import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BedDouble, History, Pencil, Plus, Power, RefreshCw, Trash2 } from "lucide-react";
import { EmptyStep, PmsNotInstalled, ROOM_STATES, ROOM_STATE_LABEL, isPmsNotInstalled, roomStateClass } from "./pmsShared";

interface RoomForm {
  roomTypeId: number;
  code: string;
  name: string;
  floor: string;
  notes: string;
  attributes: string;
  isActive: boolean;
  sortOrder: number;
}

function RoomDialog({ edit, roomTypes, onClose }: { edit: any | null; roomTypes: any[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [f, setF] = useState<RoomForm>(() =>
    edit
      ? {
          roomTypeId: edit.roomTypeId, code: edit.code ?? "", name: edit.name ?? "", floor: edit.floor ?? "", notes: edit.notes ?? "",
          attributes: (edit.attributes ?? []).join(", "), isActive: edit.isActive !== false, sortOrder: edit.sortOrder ?? 0,
        }
      : { roomTypeId: roomTypes[0]?.id ?? 0, code: "", name: "", floor: "", notes: "", attributes: "", isActive: true, sortOrder: 0 },
  );
  const done = (msg: string) => {
    void utils.hotel.adminGetRooms.invalidate();
    toast.success(msg);
    onClose();
  };
  const create = trpc.hotel.adminCreateRoom.useMutation({ onSuccess: () => done("Habitación creada"), onError: (e) => toast.error(e.message) });
  const update = trpc.hotel.adminUpdateRoom.useMutation({ onSuccess: () => done("Habitación actualizada"), onError: (e) => toast.error(e.message) });
  const pending = create.isPending || update.isPending;

  function save() {
    if (!f.roomTypeId) return toast.error("Elige la tipología");
    if (!f.code.trim()) return toast.error("Indica el número o código de la habitación");
    const payload = {
      roomTypeId: f.roomTypeId, code: f.code.trim(), name: f.name.trim() || null, floor: f.floor.trim() || null, notes: f.notes.trim() || null,
      attributes: f.attributes.split(",").map((s) => s.trim()).filter(Boolean), isActive: f.isActive, sortOrder: f.sortOrder,
    };
    if (edit) update.mutate({ id: edit.id, ...payload });
    else create.mutate(payload);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{edit ? `Editar habitación ${edit.code}` : "Nueva habitación"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Tipología *</Label>
            <Select value={f.roomTypeId ? String(f.roomTypeId) : ""} onValueChange={(v) => setF((s) => ({ ...s, roomTypeId: Number(v) }))}>
              <SelectTrigger><SelectValue placeholder="Elige la tipología" /></SelectTrigger>
              <SelectContent>{roomTypes.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Número / código *</Label><Input value={f.code} maxLength={32} onChange={(e) => setF((s) => ({ ...s, code: e.target.value }))} placeholder="101" /></div>
            <div className="space-y-1"><Label>Planta</Label><Input value={f.floor} maxLength={32} onChange={(e) => setF((s) => ({ ...s, floor: e.target.value }))} placeholder="1" /></div>
          </div>
          <div className="space-y-1"><Label>Nombre (opcional)</Label><Input value={f.name} maxLength={120} onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))} /></div>
          <div className="space-y-1"><Label>Características (separadas por comas)</Label><Input value={f.attributes} onChange={(e) => setF((s) => ({ ...s, attributes: e.target.value }))} placeholder="Vistas, accesible, terraza" /></div>
          <div className="space-y-1"><Label>Notas internas</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1"><Label>Orden</Label><Input type="number" min={0} value={f.sortOrder} onChange={(e) => setF((s) => ({ ...s, sortOrder: Math.max(0, parseInt(e.target.value) || 0) }))} /></div>
            <div className="flex items-center gap-2 pb-2"><Switch checked={f.isActive} onCheckedChange={(v) => setF((s) => ({ ...s, isActive: v }))} /><Label>{f.isActive ? "Activa" : "Desactivada"}</Label></div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ room, onClose }: { room: any; onClose: () => void }) {
  const q = trpc.hotel.adminGetRoomStateHistory.useQuery({ hotelRoomId: room.id });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Historial de la habitación {room.code}</DialogTitle></DialogHeader>
        {q.isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Cargando…</p>
        ) : !(q.data ?? []).length ? (
          <p className="text-sm text-muted-foreground py-4">Sin cambios de estado todavía. Cada cambio (manual, check-in, check-out) quedará aquí.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {(q.data ?? []).map((e: any) => (
              <li key={e.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex flex-wrap items-center gap-1">
                  {e.fromStatus && <Badge variant="outline" className={roomStateClass(e.fromStatus)}>{ROOM_STATE_LABEL[e.fromStatus] ?? e.fromStatus}</Badge>}
                  <span className="text-muted-foreground">→</span>
                  <Badge variant="outline" className={roomStateClass(e.toStatus)}>{ROOM_STATE_LABEL[e.toStatus] ?? e.toStatus}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {new Date(e.createdAt).toLocaleString("es-ES")}{e.reason ? ` · ${e.reason}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function HotelRooms() {
  const utils = trpc.useUtils();
  const typesQ = trpc.hotel.adminGetRoomTypes.useQuery();
  const roomsQ = trpc.hotel.adminGetRooms.useQuery(undefined, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const [edit, setEdit] = useState<any | null | undefined>(undefined);
  const [history, setHistory] = useState<any | null>(null);
  const [toDelete, setToDelete] = useState<any | null>(null);

  const refresh = () => void utils.hotel.adminGetRooms.invalidate();
  const toggle = trpc.hotel.adminToggleRoomActive.useMutation({ onSuccess: refresh, onError: (e) => toast.error(e.message) });
  const remove = trpc.hotel.adminDeleteRoom.useMutation({ onSuccess: () => { refresh(); toast.success("Habitación borrada"); }, onError: (e) => toast.error(e.message) });
  const setState = trpc.hotel.adminSetRoomState.useMutation({ onSuccess: () => { refresh(); toast.success("Estado actualizado"); }, onError: (e) => toast.error(e.message) });

  const roomTypes = typesQ.data ?? [];
  const rooms = roomsQ.data ?? [];
  const groups = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const r of rooms) m.set(r.roomTypeId, [...(m.get(r.roomTypeId) ?? []), r]);
    return roomTypes.filter((t: any) => m.has(t.id)).map((t: any) => ({ type: t, rooms: m.get(t.id)! }))
      .concat(Array.from(m.entries()).filter(([id]) => !roomTypes.some((t: any) => t.id === id)).map(([id, list]) => ({ type: { id, name: `Tipología ${id} (borrada)`, totalUnits: 0 }, rooms: list })));
  }, [rooms, roomTypes]);
  const mismatched = roomTypes.filter((t: any) => t.isActive && (rooms.filter((r: any) => r.roomTypeId === t.id && r.isActive).length !== t.totalUnits));

  return (
    <AdminLayout title="Habitaciones">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><BedDouble className="h-6 w-6 shrink-0" /> Habitaciones</h1>
            <p className="text-muted-foreground text-sm">Cada habitación física de tus tipologías, con su estado operativo. Es la base del planning, la asignación y la recepción.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
            <Button onClick={() => setEdit(null)} disabled={!roomTypes.length || isPmsNotInstalled(roomsQ.error)}><Plus className="h-4 w-4 mr-1" /> Nueva habitación</Button>
          </div>
        </div>

        {isPmsNotInstalled(roomsQ.error) ? (
          <PmsNotInstalled />
        ) : typesQ.isLoading || roomsQ.isLoading ? (
          <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div>
        ) : !roomTypes.length ? (
          <Card><CardContent className="p-0"><EmptyStep title="Crea primero una tipología" text="Las habitaciones físicas pertenecen a una tipología (doble, suite…). Créala en el PMS con su precio y número de unidades." href="/admin/hotel" action="Ir a tipologías" /></CardContent></Card>
        ) : !rooms.length ? (
          <Card>
            <CardContent className="p-0">
              <EmptyStep title="Crea tu primera habitación" text="Da de alta cada habitación con su número y planta para asignarlas a las reservas y ver la ocupación en el planning." />
              <div className="flex justify-center pb-10"><Button onClick={() => setEdit(null)}><Plus className="h-4 w-4 mr-1" /> Crear habitación</Button></div>
            </CardContent>
          </Card>
        ) : (
          <>
            {mismatched.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                El número de habitaciones activas no coincide con las unidades a la venta en: {mismatched.map((t: any) => `${t.name} (${rooms.filter((r: any) => r.roomTypeId === t.id && r.isActive).length} de ${t.totalUnits})`).join(", ")}. La venta sigue usando las unidades de la tipología.
              </div>
            )}
            {groups.map(({ type, rooms: list }) => (
              <Card key={type.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{type.name} <span className="text-muted-foreground font-normal">({list.length})</span></CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {list.map((r: any) => (
                      <div key={r.id} className={`rounded-lg border border-border p-3 space-y-2 min-w-0 ${r.isActive ? "" : "opacity-60"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{r.code}{r.name ? ` · ${r.name}` : ""}</div>
                            <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                              {[r.floor ? `Planta ${r.floor}` : null, ...(r.attributes ?? [])].filter(Boolean).join(" · ") || "Sin detalles"}
                            </div>
                          </div>
                          <div className="flex shrink-0">
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setHistory(r)} aria-label="Historial"><History className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEdit(r)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggle.mutate({ id: r.id, isActive: !r.isActive })} aria-label={r.isActive ? "Desactivar" : "Activar"}><Power className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setToDelete(r)} aria-label="Borrar"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </div>
                        <Select value={r.operationalStatus} onValueChange={(v) => setState.mutate({ hotelRoomId: r.id, toStatus: v as any })}>
                          <SelectTrigger className={`h-8 text-xs ${roomStateClass(r.operationalStatus)}`} aria-label="Estado operativo"><SelectValue /></SelectTrigger>
                          <SelectContent>{ROOM_STATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>

      {edit !== undefined && <RoomDialog edit={edit} roomTypes={roomTypes} onClose={() => setEdit(undefined)} />}
      {history && <HistoryDialog room={history} onClose={() => setHistory(null)} />}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la habitación {toDelete?.code}?</AlertDialogTitle>
            <AlertDialogDescription>Solo se puede borrar si nunca se ha asignado a una reserva; si no, desactívala.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (toDelete) remove.mutate({ id: toDelete.id }); setToDelete(null); }}>Borrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
