/**
 * Care Net · Reservas y calendario (/admin/care-net/reservas): reservas de SPA del Core por días (las de la web y las
 * citas en mostrador), con su estado de pago y de plaza. Una reserva pendiente se puede pagar con una sesión de bono;
 * una pagada con bono, devolver la sesión. «Cita con bono» reserva una franja libre para un cliente y descuenta la
 * sesión. Inspirada en el gestor de reservas de SPA de la aplicación de origen, adaptada a las retenciones del Core.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { BedDouble, CalendarDays, ChevronLeft, ChevronRight, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { RoomChargeDialog } from "@/components/hotel/RoomChargeDialog";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { TONE_BADGE, type Tone } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { DAY_MS, SPA_BOOKING_STATE_LABELS, daysBetween, madridToday, type SpaBookingState } from "@shared/careNet";
import { BONOS_PATH, ClientPicker, PageHeader, useCareWrite } from "./CareNetParts";

const STATE_TONE: Record<SpaBookingState, Tone> = { pendiente: "warning", confirmada: "success", anulada: "neutral", conflicto: "danger" };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
// Solo la primera letra en mayúscula («Sábado, 7 de noviembre»; `capitalize` de CSS ponía «De Noviembre»)
const dayLabel = (d: string) => {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function Reservas() {
  const { canWrite } = useCareWrite();
  const utils = trpc.useUtils();
  const [from, setFrom] = useState(madridToday());
  const [span, setSpan] = useState<1 | 7>(7);
  const to = addDays(from, span - 1);
  const list = trpc.careNet.spaReservations.useQuery({ from, to }, { refetchInterval: 60_000 });
  const [showCancelled, setShowCancelled] = useState(false);
  const [counter, setCounter] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [cancelRes, setCancelRes] = useState(false);
  const refresh = () => { utils.careNet.spaReservations.invalidate(); utils.careNet.clientsWithPacks.invalidate(); };
  const consume = trpc.careNet.consumeForReservation.useMutation({ onSuccess: (r) => { toast.success(`Pagada con bono · quedan ${r.purchase.remaining} sesiones`); refresh(); }, onError: (e) => toastError(e) });
  // Cargo a habitación: solo con Hotel Net
  const roomGuests = trpc.careNet.roomGuests.useQuery(undefined, { retry: false });
  const [toRoom, setToRoom] = useState<{ id: number; label: string } | null>(null);
  const chargeRoom = trpc.careNet.chargeReservationToRoom.useMutation({ onSuccess: () => { toast.success("Cargada a la habitación"); setToRoom(null); refresh(); }, onError: (e) => toastError(e) });
  const revert = trpc.careNet.revertConsumption.useMutation({ onSuccess: () => { toast.success("Sesión devuelta al bono"); setReverting(null); refresh(); }, onError: (e) => toastError(e) });

  const rows = (list.data ?? []).filter((r) => showCancelled || r.state !== "anulada");
  const byDay = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return m;
  }, [rows]);
  const days = daysBetween(from, to).filter((d) => span === 1 || byDay.has(d));

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5">
        <PageHeader
          title="Reservas y calendario"
          description="Reservas de SPA por día con su estado de pago. Paga con bono las reservas pendientes o da una cita en mostrador descontando una sesión."
          actions={canWrite && <Button onClick={() => setCounter(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Cita con bono</Button>}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="icon" variant="outline" aria-label="Anterior" onClick={() => setFrom(addDays(from, -span))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></Button>
            <Input type="date" aria-label="Desde" className="w-44" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            <Button size="icon" variant="outline" aria-label="Siguiente" onClick={() => setFrom(addDays(from, span))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
            <Button size="sm" variant="ghost" onClick={() => setFrom(madridToday())}>Hoy</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
              <Button size="sm" variant={span === 1 ? "secondary" : "ghost"} aria-pressed={span === 1} onClick={() => setSpan(1)}>Día</Button>
              <Button size="sm" variant={span === 7 ? "secondary" : "ghost"} aria-pressed={span === 7} onClick={() => setSpan(7)}>Semana</Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={showCancelled} onCheckedChange={(v) => setShowCancelled(!!v)} />
              Ver anuladas
            </label>
          </div>
        </div>

        {list.isLoading ? (
          <PanelLoading label="Cargando las reservas…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} />
        ) : rows.length === 0 ? (
          <PanelEmpty icon={<CalendarDays className="h-5 w-5" />} title="No hay reservas en estas fechas" description="Las reservas de la web y las citas en mostrador aparecerán aquí por día y hora.">
            {canWrite && <Button onClick={() => setCounter(true)}>Dar una cita con bono</Button>}
            <Button asChild variant="outline"><Link href="/admin/spa">Horarios y tratamientos</Link></Button>
          </PanelEmpty>
        ) : (
          days.map((d) => (
            <section key={d} className="rounded-2xl border border-border bg-card" aria-label={dayLabel(d)}>
              <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold text-foreground">{dayLabel(d)}</h2>
              {(byDay.get(d) ?? []).length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Sin reservas.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(byDay.get(d) ?? []).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="w-24 shrink-0 font-semibold tabular-nums text-foreground">{r.startTime}–{r.endTime}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium text-foreground">{r.treatmentName ?? "Tratamiento"} · {r.people} {r.people === 1 ? "persona" : "personas"}</span>
                        <span className="block break-words text-xs text-muted-foreground">{r.customerName}{r.customerPhone ? ` · ${r.customerPhone}` : ""}{r.reservationNumber ? ` · ${r.reservationNumber}` : ""}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", TONE_BADGE[STATE_TONE[r.state]])}>{SPA_BOOKING_STATE_LABELS[r.state]}</span>
                        {r.consumption && <span className={cn("rounded-full border px-2 py-0.5 text-xs", TONE_BADGE.brand)}>Bono: {r.consumption.packName}</span>}
                        {canWrite && r.state === "pendiente" && !r.consumption && (
                          <Button size="sm" variant="outline" disabled={consume.isPending} onClick={() => consume.mutate({ reservationId: r.id })}><Ticket className="mr-1 h-4 w-4" aria-hidden="true" />Pagar con bono</Button>
                        )}
                        {canWrite && r.state === "pendiente" && !r.consumption && roomGuests.data?.available && r.amountTotal > 0 && (
                          <Button size="sm" variant="outline" onClick={() => setToRoom({ id: r.id, label: `${r.amountTotal.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` })}><BedDouble className="mr-1 h-4 w-4" aria-hidden="true" />A la habitación</Button>
                        )}
                        {canWrite && r.consumption && (
                          <Button size="sm" variant="ghost" onClick={() => { setReason(""); setCancelRes(false); setReverting(r.consumption!.id); }}>Devolver sesión</Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>

      {counter && <CounterDialog onClose={() => setCounter(false)} onDone={refresh} />}
      {toRoom && (
        <RoomChargeDialog
          title="Cargar la reserva de SPA a una habitación"
          amountLabel={toRoom.label}
          guests={roomGuests.data?.guests ?? []}
          pending={chargeRoom.isPending}
          onConfirm={(hotelReservationId) => chargeRoom.mutate({ reservationId: toRoom.id, hotelReservationId })}
          onClose={() => setToRoom(null)}
        />
      )}

      <Dialog open={reverting != null} onOpenChange={(o) => !o && setReverting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Devolver la sesión al bono</DialogTitle>
            <DialogDescription>Sin anular la cita, la reserva queda pendiente de pago; anulándola, se libera la plaza.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="care-res-reason">Motivo</Label>
              <Input id="care-res-reason" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={cancelRes} onCheckedChange={(v) => setCancelRes(!!v)} />
              Anular también la cita
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverting(null)}>Cancelar</Button>
            <Button disabled={reason.trim().length < 3 || revert.isPending} onClick={() => revert.mutate({ consumptionId: reverting!, reason, cancelReservation: cancelRes })}>Devolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}

function CounterDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [client, setClient] = useState<{ id: number; name: string } | null>(null);
  const [date, setDate] = useState(madridToday());
  const [slotId, setSlotId] = useState("");
  const [persons, setPersons] = useState("1");
  const slots = trpc.careNet.spaSlotsOfDay.useQuery({ date });
  const packs = trpc.careNet.clientPacks.useQuery({ clientId: client?.id ?? 0 }, { enabled: client != null });
  const usable = (packs.data?.purchases ?? []).filter((p) => p.state === "active");
  const create = trpc.careNet.counterAppointment.useMutation({
    onSuccess: (r) => { toast.success(`Cita reservada · quedan ${r.purchase.remaining} sesiones`); onDone(); onClose(); },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cita con bono</DialogTitle>
          <DialogDescription>Reserva una franja libre y descuenta una sesión del bono del cliente (el que caduca antes).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <ClientPicker value={client} onChange={setClient} />
            {client && packs.data && (
              usable.length === 0
                ? <p className="text-sm text-warning">Este cliente no tiene bonos con sesiones. <Link href={BONOS_PATH} className="underline">Vende un bono</Link>.</p>
                : <p className="text-xs text-muted-foreground">{usable.map((p) => `${p.packName}: ${p.remaining} sesiones`).join(" · ")}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="care-ct-date">Día</Label>
              <Input id="care-ct-date" type="date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSlotId(""); } }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="care-ct-persons">Personas</Label>
              <Input id="care-ct-persons" type="number" min={1} max={20} value={persons} onChange={(e) => setPersons(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="care-ct-slot">Horario</Label>
            <Select value={slotId} onValueChange={setSlotId}>
              <SelectTrigger id="care-ct-slot" className="w-full min-w-0"><SelectValue placeholder={slots.data && slots.data.length === 0 ? "No hay horarios ese día" : "Elige el horario"} /></SelectTrigger>
              <SelectContent>
                {(slots.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)} disabled={s.free < 1}>{s.startTime} · {s.treatmentName} · {s.free} libres</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!client || !slotId || create.isPending} onClick={() => create.mutate({ clientId: client!.id, slotId: Number(slotId), persons: Math.max(1, Number(persons) || 1) })}>Reservar y descontar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
