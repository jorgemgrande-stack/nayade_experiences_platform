import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Ban, BedDouble, ConciergeBell, Lock, LogIn, LogOut, Percent, RefreshCw, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PmsNotInstalled, ROOM_STATE_LABEL, isPmsNotInstalled, roomStateClass, shortDate } from "./pmsShared";

function Kpi({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4 flex items-center gap-3 min-w-0">
        <div className="rounded-lg p-2 bg-muted text-foreground shrink-0"><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <div className="text-xl sm:text-2xl font-bold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1 overflow-hidden text-ellipsis whitespace-nowrap">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function Guest({ r, today }: { r: any; today: string }) {
  return (
    <div className="min-w-0">
      <div className="font-medium text-sm overflow-hidden text-ellipsis whitespace-nowrap">{r.customerName}</div>
      <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
        {r.roomName ?? "Habitación"} · {shortDate(r.checkIn)} → {shortDate(r.checkOut)}
        {r.assignment ? ` · hab. ${r.assignment.roomCode}` : " · sin habitación"}
        {r.checkIn < today && r.statusReservation !== "EN_CURSO" ? " · llegada atrasada" : ""}
        {r.statusReservation === "EN_CURSO" && r.checkOut < today ? " · salida vencida" : ""}
      </div>
    </div>
  );
}

export default function HotelReception() {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetReceptionDashboard.useQuery(undefined, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const d = q.data;
  const refresh = () => { void utils.hotel.adminGetReceptionDashboard.invalidate(); void utils.hotel.adminGetRooms.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const checkIn = trpc.hotel.adminCheckIn.useMutation({ onSuccess: (r) => { toast.success(r.roomCode ? `Check-in hecho · habitación ${r.roomCode}` : "Check-in hecho (sin habitación asignada)"); refresh(); }, onError });
  const checkOut = trpc.hotel.adminCheckOut.useMutation({ onSuccess: () => { toast.success("Check-out hecho"); refresh(); }, onError });
  const noShow = trpc.hotel.adminMarkNoShow.useMutation({ onSuccess: () => { toast.success("Marcada como no-show"); refresh(); }, onError });
  const busy = checkIn.isPending || checkOut.isPending || noShow.isPending;

  const roomStates = Object.entries(d?.roomStates ?? {}).filter(([, n]) => (n as number) > 0);

  return (
    <AdminLayout title="Recepción">
      <div className="space-y-5 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2"><ConciergeBell className="h-6 w-6 shrink-0" /> Recepción</h1>
            <p className="text-muted-foreground text-sm">Llegadas, salidas y huéspedes en casa{d ? ` · hoy ${new Date(`${d.today}T00:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}` : ""}.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href="/admin/hotel/reservas">Reservas</Link></Button>
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Actualizar"><RefreshCw className={`h-4 w-4 ${q.isFetching ? "animate-spin" : ""}`} /></Button>
          </div>
        </div>

        {isPmsNotInstalled(q.error) ? (
          <PmsNotInstalled />
        ) : q.isLoading ? (
          <div className="text-center py-12 text-muted-foreground"><RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Cargando…</div>
        ) : q.error ? (
          <Card><CardContent className="p-6 text-sm text-destructive">{q.error.message}</CardContent></Card>
        ) : d && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi icon={LogIn} label="Llegadas pendientes" value={d.arrivals.length} />
              <Kpi icon={LogOut} label="Salidas de hoy" value={d.departures.filter((r: any) => r.statusReservation === "EN_CURSO").length} />
              <Kpi icon={Users} label="Huéspedes en casa" value={d.inHouse.length} />
              <Kpi icon={Percent} label="Ocupación esta noche" value={`${d.occupancyPct}%`} />
              <Kpi icon={Ban} label="No-shows de hoy" value={d.noShowsToday} />
              <Kpi icon={Sparkles} label="Habitaciones sucias" value={d.roomsDirty} />
              <Kpi icon={Lock} label="Fuera de servicio" value={d.roomsOutOfService} />
              <Kpi icon={BedDouble} label="Habitaciones físicas" value={d.physicalRooms} />
            </div>

            {d.physicalRooms === 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Aún no hay habitaciones físicas: puedes hacer check-in igualmente, pero sin asignar habitación. <Link href="/admin/hotel/habitaciones" className="underline font-medium">Crea tu primera habitación</Link>.
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-4">
              <Card className="min-w-0">
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><LogIn className="h-4 w-4" /> Llegadas</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {d.arrivals.length === 0 && <p className="text-sm text-muted-foreground">No quedan llegadas pendientes hoy. Las nuevas reservas se crean en <Link href="/admin/hotel/reservas" className="underline">Reservas</Link>.</p>}
                  {d.arrivals.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                      <Guest r={r} today={d.today} />
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" onClick={() => checkIn.mutate({ reservationId: r.id })} disabled={busy}><LogIn className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Check-in</span></Button>
                        <Button size="sm" variant="ghost" onClick={() => noShow.mutate({ reservationId: r.id })} disabled={busy} aria-label="Marcar como no-show" title="No-show"><Ban className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><LogOut className="h-4 w-4" /> Salidas</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {d.departures.length === 0 && <p className="text-sm text-muted-foreground">No hay salidas previstas hoy.</p>}
                  {d.departures.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                      <Guest r={r} today={d.today} />
                      {r.statusReservation === "FINALIZADA"
                        ? <Badge variant="secondary" className="shrink-0">Salida hecha</Badge>
                        : <Button size="sm" className="shrink-0" onClick={() => checkOut.mutate({ reservationId: r.id })} disabled={busy}><LogOut className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Check-out</span></Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" /> En casa</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {d.inHouse.length === 0 && <p className="text-sm text-muted-foreground">No hay huéspedes alojados ahora mismo.</p>}
                  {d.inHouse.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                      <Guest r={r} today={d.today} />
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => checkOut.mutate({ reservationId: r.id })} disabled={busy} title="Check-out"><LogOut className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base flex items-center gap-2"><BedDouble className="h-4 w-4" /> Estado de las habitaciones</CardTitle>
                <Button variant="link" size="sm" asChild><Link href="/admin/hotel/habitaciones">Gestionar</Link></Button>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {roomStates.length === 0 && <p className="text-sm text-muted-foreground">Sin habitaciones físicas activas.</p>}
                {roomStates.map(([s, n]) => (
                  <Badge key={s} variant="outline" className={roomStateClass(s)}>{ROOM_STATE_LABEL[s] ?? s}: {n as number}</Badge>
                ))}
              </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground">El check-in asigna automáticamente una habitación libre si la reserva no tenía. El check-out deja la habitación como sucia y el no-show, libre.</p>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
