import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Ban, BedDouble, CalendarDays, IdCard, Link2, Link2Off, LogIn, LogOut, Plus, Receipt, RefreshCw, Wand2 } from "lucide-react";
import FolioDialog from "./FolioDialog";
import GuestsDialog from "./GuestsDialog";
import {
  CHANNEL_LABEL, EmptyStep, PAYMENT_LABEL, PmsNotInstalled, STAY_LABEL, addDays, eur, isPmsNotInstalled, localToday, shortDate,
} from "./pmsShared";

function nightsOf(a: string, b: string) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));
}

function NewReservationDialog({ roomTypes, rooms, onClose }: { roomTypes: any[]; rooms: any[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const today = localToday();
  const [roomTypeId, setRoomTypeId] = useState<number | null>(roomTypes[0]?.id ?? null);
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(addDays(today, 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [total, setTotal] = useState("");
  const [channel, setChannel] = useState<"MANUAL" | "TELEFONO" | "EMAIL" | "TPV_FISICO">("MANUAL");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [force, setForce] = useState(false);
  const [hotelRoomId, setHotelRoomId] = useState<number | null>(null);
  const [ratePlanId, setRatePlanId] = useState<string>("none");
  const plansQ = trpc.hotel.adminListRatePlans.useQuery(roomTypeId ? { roomTypeId } : undefined, { enabled: !!roomTypeId, retry: false });
  const plans = (plansQ.data ?? []).filter((p) => p.isActive);
  const nights = nightsOf(checkIn, checkOut);
  const roomsForType = rooms.filter((r) => r.roomTypeId === roomTypeId && r.isActive);
  const type = roomTypes.find((t) => t.id === roomTypeId);

  const create = trpc.hotel.adminCreateReservation.useMutation({
    onSuccess: (r) => {
      toast.success(`Reserva ${r.reservationNumber} creada · ${eur(r.amountCents)}`);
      void utils.hotel.adminListReservations.invalidate();
      void utils.hotel.adminGetReceptionDashboard.invalidate();
      void utils.hotel.adminGetPlanning.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!roomTypeId) return toast.error("Elige la tipología");
    if (nights < 1) return toast.error("La salida debe ser posterior a la entrada");
    if (customerName.trim().length < 2) return toast.error("Indica el nombre del huésped");
    const t = total.trim() === "" ? undefined : Number(total.replace(",", "."));
    if (t !== undefined && (!Number.isFinite(t) || t < 0)) return toast.error("Importe no válido");
    create.mutate({
      roomTypeId, checkIn, checkOut, adults, children, totalEuros: t, channel,
      customerName: customerName.trim(), customerEmail: customerEmail.trim(), customerPhone: customerPhone.trim() || undefined,
      notes: notes.trim() || undefined, force, hotelRoomId: hotelRoomId ?? undefined,
      ratePlanId: ratePlanId === "none" ? undefined : Number(ratePlanId),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Nueva reserva de hotel</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div className="sm:col-span-2 space-y-1">
            <Label>Tipología</Label>
            <Select value={roomTypeId ? String(roomTypeId) : ""} onValueChange={(v) => { setRoomTypeId(Number(v)); setHotelRoomId(null); setRatePlanId("none"); }}>
              <SelectTrigger><SelectValue placeholder="Elige la tipología" /></SelectTrigger>
              <SelectContent>{roomTypes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Entrada</Label><Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></div>
          <div className="space-y-1"><Label>Salida</Label><Input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} /></div>
          <div className="space-y-1"><Label>Adultos</Label><Input type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} /></div>
          <div className="space-y-1"><Label>Niños</Label><Input type="number" min={0} max={20} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} /></div>
          {plans.length > 0 && (
            <div className="sm:col-span-2 space-y-1">
              <Label>Plan de tarifa</Label>
              <Select value={ratePlanId} onValueChange={setRatePlanId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Tarifa de la noche (sin plan)</SelectItem>
                  {plans.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}{p.refundable ? "" : " · no reembolsable"}{p.includesBreakfast ? " · desayuno" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="sm:col-span-2 space-y-1">
            <Label>Importe total (€)</Label>
            <Input inputMode="decimal" placeholder={type && nights > 0 ? `Vacío = tarifa de cada noche (${nights} noche${nights > 1 ? "s" : ""})` : "Vacío = tarifa de cada noche"} value={total} onChange={(e) => setTotal(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Canal</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Recepción</SelectItem>
                <SelectItem value="TELEFONO">Teléfono</SelectItem>
                <SelectItem value="EMAIL">Correo</SelectItem>
                <SelectItem value="TPV_FISICO">TPV</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Habitación (opcional)</Label>
            <Select value={hotelRoomId ? String(hotelRoomId) : "none"} onValueChange={(v) => setHotelRoomId(v === "none" ? null : Number(v))}>
              <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {roomsForType.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.code}{r.name ? ` · ${r.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Huésped *</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Teléfono</Label><Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Correo</Label><Input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} /></div>
          <div className="sm:col-span-2 space-y-1"><Label>Notas</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="sm:col-span-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40">
            <Switch checked={force} onCheckedChange={setForce} />
            <Label className="text-amber-900 dark:text-amber-200 leading-snug">Forzar: alojar aunque la tipología esté completa o la estancia incumpla sus restricciones</Label>
          </div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">La reserva queda confirmada y pendiente de pago; el cobro se registra desde el módulo de reservas.</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending}>{create.isPending ? "Creando…" : "Crear reserva"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({ reservation, rooms, onClose }: { reservation: any; rooms: any[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [hotelRoomId, setHotelRoomId] = useState<number | null>(reservation.assignment?.hotelRoomId ?? null);
  const roomsForType = rooms.filter((r) => r.roomTypeId === reservation.roomTypeId && r.isActive);
  const assign = trpc.hotel.adminAssignRoom.useMutation({
    onSuccess: (r) => {
      toast.success(`Habitación ${r.roomCode} asignada`);
      void utils.hotel.adminListReservations.invalidate();
      void utils.hotel.adminGetPlanning.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Asignar habitación · {reservation.reservationNumber}</DialogTitle></DialogHeader>
        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">{reservation.customerName} · {reservation.roomName} · {shortDate(reservation.checkIn)} → {shortDate(reservation.checkOut)}</p>
          {roomsForType.length === 0 ? (
            <p className="text-sm">Esta tipología no tiene habitaciones físicas activas. Créalas en Habitaciones.</p>
          ) : (
            <Select value={hotelRoomId ? String(hotelRoomId) : ""} onValueChange={(v) => setHotelRoomId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Elige la habitación" /></SelectTrigger>
              <SelectContent>{roomsForType.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.code}{r.name ? ` · ${r.name}` : ""}{r.floor ? ` (planta ${r.floor})` : ""}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => hotelRoomId && assign.mutate({ reservationId: reservation.id, hotelRoomId })} disabled={!hotelRoomId || assign.isPending}>Asignar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function stayBadge(r: any) {
  if (r.status === "cancelled" || r.status === "failed") return <Badge variant="destructive">{PAYMENT_LABEL[r.status]}</Badge>;
  if (!r.occupies && r.statusReservation !== "NO_SHOW") return <Badge variant="outline">Caducada</Badge>;
  const s = r.statusReservation ?? "PENDIENTE_CONFIRMACION";
  return <Badge variant={s === "EN_CURSO" ? "default" : s === "NO_SHOW" ? "destructive" : "secondary"}>{STAY_LABEL[s] ?? s}</Badge>;
}

export default function HotelReservations() {
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(() => addDays(localToday(), -7));
  const [to, setTo] = useState(() => addDays(localToday(), 30));
  const [status, setStatus] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<any | null>(null);
  const [folioId, setFolioId] = useState<number | null>(null);
  const [guestsFor, setGuestsFor] = useState<{ id: number; title: string } | null>(null);
  const validRange = from && to && from <= to;
  const listQ = trpc.hotel.adminListReservations.useQuery(
    { range: { from, to }, status: status === "all" ? undefined : (status as any) },
    { enabled: !!validRange, retry: (n, e) => !isPmsNotInstalled(e) && n < 2 },
  );
  const typesQ = trpc.hotel.adminGetRoomTypes.useQuery();
  const roomsQ = trpc.hotel.adminGetRooms.useQuery(undefined, { retry: false });

  const refresh = () => { void utils.hotel.adminListReservations.invalidate(); void utils.hotel.adminGetPlanning.invalidate(); void utils.hotel.adminGetReceptionDashboard.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const unassign = trpc.hotel.adminUnassignRoom.useMutation({ onSuccess: () => { toast.success("Habitación retirada"); refresh(); }, onError });
  const auto = trpc.hotel.adminAutoAssignRoom.useMutation({ onSuccess: (r: any) => { toast.success(r.alreadyAssigned ? "Ya tenía habitación" : `Habitación ${r.roomCode} asignada`); refresh(); }, onError });
  const checkIn = trpc.hotel.adminCheckIn.useMutation({ onSuccess: () => { toast.success("Check-in hecho"); refresh(); }, onError });
  const checkOut = trpc.hotel.adminCheckOut.useMutation({ onSuccess: () => { toast.success("Check-out hecho"); refresh(); }, onError });
  const noShow = trpc.hotel.adminMarkNoShow.useMutation({ onSuccess: () => { toast.success("Marcada como no-show"); refresh(); }, onError });
  const busy = checkIn.isPending || checkOut.isPending || noShow.isPending || auto.isPending || unassign.isPending;

  const rows = listQ.data ?? [];
  const roomTypes = typesQ.data ?? [];
  const count = useMemo(() => rows.length, [rows]);

  return (
    <AdminLayout title="Reservas de hotel">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="h-6 w-6 shrink-0" /> Reservas de hotel</h1>
            <p className="text-muted-foreground text-sm">Reservas web y de recepción, con su habitación física y su estado de estancia.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
            <Button onClick={() => setNewOpen(true)} disabled={!roomTypes.length || isPmsNotInstalled(listQ.error)}><Plus className="h-4 w-4 mr-1" /> Nueva reserva</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs">Desde</Label><Input type="date" className="w-40" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
          <div className="space-y-1"><Label className="text-xs">Hasta</Label><Input type="date" className="w-40" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
          <div className="space-y-1">
            <Label className="text-xs">Pago</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="pending_payment">Pendientes de pago</SelectItem>
                <SelectItem value="paid">Pagadas</SelectItem>
                <SelectItem value="cancelled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground pb-2">{count} reserva{count !== 1 ? "s" : ""}</span>
        </div>

        {isPmsNotInstalled(listQ.error) ? (
          <PmsNotInstalled />
        ) : !roomTypes.length && !typesQ.isLoading ? (
          <Card><CardContent className="p-0"><EmptyStep title="Crea primero una tipología" text="Las reservas de hotel se hacen sobre una tipología con su precio y unidades." href="/admin/hotel" action="Ir a tipologías" /></CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead className="border-b border-border bg-muted/40">
                    <tr className="text-left">
                      <th className="p-3 font-medium">Nº</th>
                      <th className="p-3 font-medium">Huésped</th>
                      <th className="p-3 font-medium">Tipología</th>
                      <th className="p-3 font-medium">Fechas</th>
                      <th className="p-3 font-medium">Importe</th>
                      <th className="p-3 font-medium">Pago</th>
                      <th className="p-3 font-medium">Estancia</th>
                      <th className="p-3 font-medium">Habitación</th>
                      <th className="sticky right-0 bg-muted p-3 font-medium text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listQ.isLoading && <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Cargando…</td></tr>}
                    {listQ.error && !isPmsNotInstalled(listQ.error) && <tr><td colSpan={9} className="p-6 text-center text-destructive">{listQ.error.message}</td></tr>}
                    {!listQ.isLoading && !listQ.error && rows.length === 0 && (
                      <tr><td colSpan={9} className="p-0"><EmptyStep title="Sin reservas en estas fechas" text="Amplía el rango de fechas o crea una reserva de recepción con «Nueva reserva»." /></td></tr>
                    )}
                    {rows.map((r: any) => {
                      const s = r.statusReservation ?? "PENDIENTE_CONFIRMACION";
                      const canCheckIn = r.occupies && s !== "EN_CURSO" && s !== "FINALIZADA" && s !== "NO_SHOW";
                      return (
                        <tr key={r.id} className="border-b border-border hover:bg-muted/20 align-top">
                          <td className="p-3 font-mono text-xs whitespace-nowrap">{r.reservationNumber ?? r.id}</td>
                          <td className="p-3 max-w-[220px]">
                            <div className="font-medium overflow-hidden text-ellipsis whitespace-nowrap">{r.customerName}</div>
                            <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{r.customerEmail || r.customerPhone || "—"} · {CHANNEL_LABEL[r.channel] ?? r.channel ?? "—"}</div>
                          </td>
                          <td className="p-3">{r.roomName ?? "—"}</td>
                          <td className="p-3 whitespace-nowrap">{shortDate(r.checkIn)} → {shortDate(r.checkOut)}<div className="text-xs text-muted-foreground">{r.nights} noche{r.nights === 1 ? "" : "s"} · {r.people} pers.</div></td>
                          <td className="p-3 whitespace-nowrap">{eur(r.amountTotal)}{r.amountPaid > 0 && r.amountPaid < r.amountTotal && <div className="text-xs text-amber-600 dark:text-amber-400">pagado {eur(r.amountPaid)}</div>}</td>
                          <td className="p-3"><Badge variant={r.status === "paid" ? "default" : "outline"}>{PAYMENT_LABEL[r.status] ?? r.status}</Badge></td>
                          <td className="p-3">{stayBadge(r)}</td>
                          <td className="p-3">{r.assignment ? <Badge variant="outline" className="gap-1"><BedDouble className="h-3 w-3" /> {r.assignment.roomCode}</Badge> : <span className="text-xs text-muted-foreground">Sin asignar</span>}</td>
                          <td className="sticky right-0 bg-card p-3 whitespace-nowrap text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.25)]">
                            {canCheckIn && <Button variant="ghost" size="sm" onClick={() => checkIn.mutate({ reservationId: r.id })} disabled={busy} title="Check-in"><LogIn className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></Button>}
                            {s === "EN_CURSO" && <Button variant="ghost" size="sm" onClick={() => checkOut.mutate({ reservationId: r.id })} disabled={busy} title="Check-out"><LogOut className="h-4 w-4 text-violet-600 dark:text-violet-400" /></Button>}
                            {canCheckIn && <Button variant="ghost" size="sm" onClick={() => noShow.mutate({ reservationId: r.id })} disabled={busy} title="No-show"><Ban className="h-4 w-4" /></Button>}
                            {(r.occupies || s === "FINALIZADA") && <Button variant="ghost" size="sm" onClick={() => setGuestsFor({ id: r.id, title: r.customerName })} title="Huéspedes"><IdCard className="h-4 w-4" /></Button>}
                            {(r.occupies || s === "FINALIZADA") && <Button variant="ghost" size="sm" onClick={() => setFolioId(r.id)} title="Folio de la estancia"><Receipt className="h-4 w-4 text-amber-600 dark:text-amber-400" /></Button>}
                            {r.occupies && s !== "FINALIZADA" && !r.assignment && <Button variant="ghost" size="sm" onClick={() => auto.mutate({ reservationId: r.id })} disabled={busy} title="Asignar automáticamente"><Wand2 className="h-4 w-4" /></Button>}
                            {r.occupies && s !== "FINALIZADA" && <Button variant="ghost" size="sm" onClick={() => setAssignTarget(r)} disabled={busy} title={r.assignment ? "Cambiar habitación" : "Asignar habitación"}><Link2 className="h-4 w-4" /></Button>}
                            {r.assignment && s !== "EN_CURSO" && s !== "FINALIZADA" && <Button variant="ghost" size="sm" onClick={() => unassign.mutate({ reservationId: r.id })} disabled={busy} title="Quitar habitación"><Link2Off className="h-4 w-4 text-destructive" /></Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {newOpen && <NewReservationDialog roomTypes={roomTypes} rooms={roomsQ.data ?? []} onClose={() => setNewOpen(false)} />}
      {folioId !== null && <FolioDialog reservationId={folioId} onClose={() => setFolioId(null)} />}
      {guestsFor && <GuestsDialog reservationId={guestsFor.id} title={guestsFor.title} onClose={() => setGuestsFor(null)} />}
      {assignTarget && <AssignDialog reservation={assignTarget} rooms={roomsQ.data ?? []} onClose={() => setAssignTarget(null)} />}
    </AdminLayout>
  );
}
