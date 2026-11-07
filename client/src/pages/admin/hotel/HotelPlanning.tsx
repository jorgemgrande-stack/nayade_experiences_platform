import { Fragment, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertCircle, CalendarRange, ChevronLeft, ChevronRight, Wand2 } from "lucide-react";
import { EmptyStep, PmsNotInstalled, ROOM_STATE_LABEL, addDays, isPmsNotInstalled, localToday, roomStateClass, shortDate } from "./pmsShared";

const WINDOW_DAYS = 14;
const DOW = ["D", "L", "M", "X", "J", "V", "S"];

function barClass(a: any) {
  const s = a.reservation?.statusReservation;
  if (s === "EN_CURSO") return "bg-blue-600 text-white dark:bg-blue-500";
  if (s === "FINALIZADA") return "bg-muted text-muted-foreground";
  if (a.reservation?.status === "paid") return "bg-emerald-600 text-white dark:bg-emerald-500";
  return "bg-amber-400 text-amber-950 dark:bg-amber-500";
}

function MoveDialog({ assignment, rooms, onClose }: { assignment: any; rooms: any[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const current = rooms.find((r) => r.id === assignment.hotelRoomId);
  const [roomId, setRoomId] = useState(String(assignment.hotelRoomId));
  const move = trpc.hotel.adminAssignRoom.useMutation({
    onSuccess: (r) => { toast.success(`Movida a la habitación ${r.roomCode}`); void utils.hotel.adminGetPlanning.invalidate(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  const candidates = rooms.filter((r) => r.isActive && r.roomTypeId === current?.roomTypeId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Cambiar de habitación · {assignment.reservation?.customerName ?? assignment.reservationId}</DialogTitle></DialogHeader>
        <div className="py-2 space-y-2 text-sm">
          <p className="text-muted-foreground">{assignment.reservation?.reservationNumber} · {shortDate(assignment.checkIn)} → {shortDate(assignment.checkOut)}</p>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger><SelectValue placeholder="Habitación" /></SelectTrigger>
            <SelectContent>{candidates.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.code}{r.name ? ` · ${r.name}` : ""}</SelectItem>)}</SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Solo habitaciones de la misma tipología: la venta de la reserva se hizo sobre ella.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => move.mutate({ reservationId: assignment.reservationId, hotelRoomId: Number(roomId) })} disabled={move.isPending || roomId === String(assignment.hotelRoomId)}>Mover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RestrictionsCard({ roomTypes, from, to }: { roomTypes: any[]; from: string; to: string }) {
  const utils = trpc.useUtils();
  const [typeId, setTypeId] = useState<number | null>(roomTypes[0]?.id ?? null);
  const [rFrom, setRFrom] = useState(from);
  const [rTo, setRTo] = useState(from);
  const [minStay, setMinStay] = useState("");
  const [maxStay, setMaxStay] = useState("");
  const [cta, setCta] = useState(false);
  const [ctd, setCtd] = useState(false);
  const listQ = trpc.hotel.adminGetStayRestrictions.useQuery({ range: { from, to } }, { retry: false });
  const save = trpc.hotel.adminSetStayRestrictions.useMutation({
    onSuccess: (r) => { toast.success(`Restricciones guardadas en ${r.days} día${r.days === 1 ? "" : "s"}`); void utils.hotel.adminGetStayRestrictions.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const toNum = (v: string) => (v.trim() === "" ? null : Math.max(0, parseInt(v) || 0));
  const typeName = (id: number) => roomTypes.find((t) => t.id === id)?.name ?? `Tipología ${id}`;
  const list = listQ.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Restricciones de estancia</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Estancia mínima o máxima según el día de llegada, y días cerrados a llegadas o salidas. Se aplican a la reserva web y a recepción (salvo «Forzar»).</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <div className="col-span-2 lg:col-span-1 space-y-1">
            <Label className="text-xs">Tipología</Label>
            <Select value={typeId ? String(typeId) : ""} onValueChange={(v) => setTypeId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Tipología" /></SelectTrigger>
              <SelectContent>{roomTypes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" value={rFrom} onChange={(e) => e.target.value && setRFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" value={rTo} min={rFrom} onChange={(e) => e.target.value && setRTo(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2 col-span-2 lg:col-span-1">
            <div className="space-y-1"><Label className="text-xs">Mín. noches</Label><Input inputMode="numeric" value={minStay} onChange={(e) => setMinStay(e.target.value)} placeholder="—" /></div>
            <div className="space-y-1"><Label className="text-xs">Máx. noches</Label><Input inputMode="numeric" value={maxStay} onChange={(e) => setMaxStay(e.target.value)} placeholder="—" /></div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><Switch checked={cta} onCheckedChange={setCta} /> Cerrado a llegadas</label>
          <label className="flex items-center gap-2 text-sm"><Switch checked={ctd} onCheckedChange={setCtd} /> Cerrado a salidas</label>
          <Button
            size="sm"
            disabled={!typeId || save.isPending || rFrom > rTo}
            onClick={() => typeId && save.mutate({ roomTypeId: typeId, range: { from: rFrom, to: rTo }, minStay: toNum(minStay), maxStay: toNum(maxStay), closedToArrival: cta, closedToDeparture: ctd })}
          >
            Guardar
          </Button>
          <span className="text-xs text-muted-foreground">Deja todo vacío y desactivado para quitar las restricciones del rango.</span>
        </div>
        {isPmsNotInstalled(listQ.error) ? null : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin restricciones entre el {shortDate(from)} y el {shortDate(to)}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="border-b border-border text-left"><tr><th className="p-2 font-medium">Día</th><th className="p-2 font-medium">Tipología</th><th className="p-2 font-medium">Restricción</th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="p-2 whitespace-nowrap">{shortDate(r.date)}</td>
                    <td className="p-2">{typeName(r.roomTypeId)}</td>
                    <td className="p-2">{[r.minStay ? `mín. ${r.minStay} n.` : null, r.maxStay ? `máx. ${r.maxStay} n.` : null, r.closedToArrival ? "sin llegadas" : null, r.closedToDeparture ? "sin salidas" : null].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function HotelPlanning() {
  const utils = trpc.useUtils();
  const [start, setStart] = useState(localToday());
  const days = useMemo(() => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(start, i)), [start]);
  const from = days[0];
  const to = days[days.length - 1];
  const [moveTarget, setMoveTarget] = useState<any | null>(null);
  const planQ = trpc.hotel.adminGetPlanning.useQuery({ from, to }, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const typesQ = trpc.hotel.adminGetRoomTypes.useQuery();
  const autoAll = trpc.hotel.adminAutoAssignAll.useMutation({
    onSuccess: (r) => {
      if (r.failed.length) toast.warning(`Asignadas ${r.assigned}; ${r.failed.length} sin habitación libre`, { description: r.failed.slice(0, 3).map((f) => `${f.reservationNumber ?? f.reservationId}: ${f.reason}`).join("\n") });
      else toast.success(r.assigned ? `Asignadas ${r.assigned} reservas` : "No había reservas por asignar");
      void utils.hotel.adminGetPlanning.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const today = planQ.data?.today ?? localToday();
  const rooms = planQ.data?.rooms ?? [];
  const assignments = planQ.data?.assignments ?? [];
  const unassigned = planQ.data?.unassigned ?? [];

  const occ = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of assignments) {
      for (let d = a.checkIn < from ? from : a.checkIn; d < a.checkOut && d <= to; d = addDays(d, 1)) m.set(`${a.hotelRoomId}|${d}`, a);
    }
    return m;
  }, [assignments, from, to]);

  const groups = useMemo(() => {
    const g: { type: string; rooms: any[] }[] = [];
    for (const r of rooms) {
      const last = g[g.length - 1];
      if (!last || last.type !== r.roomTypeName) g.push({ type: r.roomTypeName, rooms: [r] });
      else last.rooms.push(r);
    }
    return g;
  }, [rooms]);

  return (
    <AdminLayout title="Planning">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarRange className="h-6 w-6 shrink-0" /> Planning de habitaciones</h1>
            <p className="text-muted-foreground text-sm">Ocupación por habitación física. Pulsa una estancia para cambiarla de habitación.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => autoAll.mutate({ from, to })} disabled={autoAll.isPending || isPmsNotInstalled(planQ.error)}><Wand2 className="h-4 w-4 mr-1" /> Asignar automáticamente</Button>
            <Button variant="outline" size="icon" onClick={() => setStart(addDays(start, -7))} aria-label="Semana anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setStart(localToday())}>Hoy</Button>
            <Input type="date" className="w-40" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} aria-label="Primer día" />
            <Button variant="outline" size="icon" onClick={() => setStart(addDays(start, 7))} aria-label="Semana siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        {isPmsNotInstalled(planQ.error) ? (
          <PmsNotInstalled />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-emerald-600 dark:bg-emerald-500" /> Pagada</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-400 dark:bg-amber-500" /> Pendiente de pago</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-600 dark:bg-blue-500" /> En casa</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-muted border border-border" /> Salida hecha</span>
            </div>

            {unassigned.length > 0 && (
              <Card className="border-amber-300 dark:border-amber-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-300">
                    <AlertCircle className="h-4 w-4" /> {unassigned.length} reserva{unassigned.length !== 1 ? "s" : ""} sin habitación en estas fechas
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {unassigned.map((u: any) => (
                    <Link key={u.reservationId} href="/admin/hotel/reservas">
                      <Badge variant="outline" className="cursor-pointer hover:bg-muted max-w-full overflow-hidden text-ellipsis whitespace-nowrap">
                        {u.customerName} · {u.roomName} · {shortDate(u.checkIn)} → {shortDate(u.checkOut)}
                      </Badge>
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="p-0 overflow-x-auto">
                {planQ.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Cargando…</div>
                ) : planQ.error ? (
                  <div className="p-8 text-center text-destructive text-sm">{planQ.error.message}</div>
                ) : rooms.length === 0 ? (
                  <EmptyStep title="Crea tu primera habitación" text="El planning muestra la ocupación de cada habitación física. Da de alta tus habitaciones para empezar." href="/admin/hotel/habitaciones" action="Ir a habitaciones" />
                ) : (
                  <table className="border-collapse text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-muted p-2 text-left min-w-[120px] border-b border-r border-border">Habitación</th>
                        {days.map((d) => {
                          const dt = new Date(`${d}T00:00:00Z`);
                          const weekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
                          return (
                            <th key={d} className={`p-1 text-center font-medium border-b border-border min-w-[40px] ${d === today ? "bg-primary/15" : weekend ? "bg-muted/50" : ""}`}>
                              <div className="text-[10px] text-muted-foreground">{DOW[dt.getUTCDay()]}</div>
                              <div>{dt.getUTCDate()}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map((g) => (
                        <Fragment key={`g-${g.type}`}>
                          <tr>
                            <td colSpan={days.length + 1} className="bg-muted/40 px-2 py-1 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">{g.type}</td>
                          </tr>
                          {g.rooms.map((room) => (
                            <tr key={room.id} className={room.isActive ? "" : "opacity-50"}>
                              <td className="sticky left-0 z-10 bg-background p-2 border-b border-r border-border whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium">{room.code}</span>
                                  {room.floor ? <span className="text-[10px] text-muted-foreground">P{room.floor}</span> : null}
                                </div>
                                <Badge variant="outline" className={`mt-0.5 text-[10px] px-1 py-0 ${roomStateClass(room.operationalStatus)}`}>{ROOM_STATE_LABEL[room.operationalStatus] ?? room.operationalStatus}</Badge>
                              </td>
                              {days.map((d) => {
                                const a = occ.get(`${room.id}|${d}`);
                                if (!a) return <td key={d} className={`border-b border-l border-border h-10 ${d === today ? "bg-primary/5" : ""}`} />;
                                const first = d === (a.checkIn < from ? from : a.checkIn);
                                return (
                                  <td key={d} className="border-b border-l border-border p-0 h-10">
                                    <button
                                      type="button"
                                      className={`h-full w-full flex items-center px-1 overflow-hidden whitespace-nowrap text-left ${barClass(a)}`}
                                      title={`${a.reservation?.customerName ?? ""} · ${a.reservation?.reservationNumber ?? ""} · ${a.checkIn} → ${a.checkOut}`}
                                      onClick={() => setMoveTarget(a)}
                                    >
                                      {first && <span className="text-[10px] font-medium overflow-hidden text-ellipsis whitespace-nowrap">{a.reservation?.customerName ?? `#${a.reservationId}`}</span>}
                                    </button>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            {(typesQ.data ?? []).length > 0 && <RestrictionsCard roomTypes={typesQ.data ?? []} from={from} to={to} />}
          </>
        )}
      </div>
      {moveTarget && <MoveDialog assignment={moveTarget} rooms={rooms} onClose={() => setMoveTarget(null)} />}
    </AdminLayout>
  );
}
