/**
 * Restaurant Net · Sala y comandas (/admin/restaurant-net/sala): plano o listado de mesas con su estado (libre, ocupada,
 * pide la cuenta) y las reservas del día. Pulsar una mesa libre abre su comanda; una ocupada, la comanda que tiene.
 * Las reservas se asignan a una mesa y, al llegar, se sientan (abre la comanda enlazada a la reserva).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { CalendarClock, LayoutGrid, List, Map as MapIcon, Settings2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { TABLE_STATE_LABELS, tableStates } from "@shared/restaurantNet";
import {
  CARTA_PATH,
  CONFIG_PATH,
  FloorPlan,
  NoRestaurants,
  PageHeader,
  RestaurantPicker,
  StateLegend,
  TableGrid,
  comandaPath,
  useRestaurantChoice,
  useRestaurantNetWrite,
  type PlanBadge,
  type PlanTable,
} from "./RestaurantNetParts";

const VIEW_KEY = "rnet.salaView";

export default function Sala() {
  const choice = useRestaurantChoice();
  const { canWrite, isAdmin } = useRestaurantNetWrite();
  const [, navigate] = useLocation();
  const restaurantId = choice.restaurantId;
  const utils = trpc.useUtils();
  const floor = trpc.restaurantNet.getFloor.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null, refetchInterval: 15_000 });
  const menu = trpc.restaurantNet.listMenu.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null });
  const bookings = trpc.restaurantNet.listDayBookings.useQuery({ restaurantId: restaurantId! }, { enabled: restaurantId != null, refetchInterval: 60_000 });
  const [roomTab, setRoomTab] = useState<number | null>(null);
  const [view, setView] = useState<"plano" | "lista">(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "plano" || v === "lista") return v;
    } catch {
      /* sin almacenamiento */
    }
    return window.innerWidth < 640 ? "lista" : "plano";
  });
  const [opening, setOpening] = useState<PlanTable | null>(null);
  const [guests, setGuests] = useState("2");
  const [customerName, setCustomerName] = useState("");
  const [seating, setSeating] = useState<number | null>(null);
  const [seatTable, setSeatTable] = useState<string>("");

  const rooms = floor.data?.rooms ?? [];
  useEffect(() => {
    if (rooms.length && (roomTab == null || !rooms.some((r) => r.id === roomTab))) setRoomTab(rooms[0].id);
  }, [floor.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const setViewSaved = (v: "plano" | "lista") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const tables = floor.data?.tables ?? [];
  const states = useMemo(() => tableStates(tables, floor.data?.openOrders ?? []), [floor.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const orderById = useMemo(() => new Map((floor.data?.openOrders ?? []).map((o) => [o.id, o] as const)), [floor.data]);
  const badges = useMemo(() => {
    const m = new Map<number, PlanBadge>();
    for (const t of tables) {
      const s = states.get(t.id);
      const o = s?.orderId != null ? orderById.get(s.orderId) : undefined;
      m.set(t.id, { state: s?.state ?? "libre", total: o?.total ?? null, guests: o?.guests ?? null });
    }
    return m;
  }, [tables, states, orderById]);
  const counts = { libre: 0, ocupada: 0, cuenta: 0 };
  for (const t of tables) counts[badges.get(t.id)?.state ?? "libre"]++;

  const openOrder = trpc.restaurantNet.openOrder.useMutation({
    onSuccess: (r) => { setOpening(null); navigate(comandaPath(r.id)); },
    onError: (e) => { toastError(e); utils.restaurantNet.getFloor.invalidate(); },
  });
  const seat = trpc.restaurantNet.seatBooking.useMutation({
    onSuccess: (r) => { setSeating(null); navigate(comandaPath(r.orderId)); },
    onError: (e) => toastError(e),
  });
  const assign = trpc.restaurantNet.assignBookingTable.useMutation({ onSuccess: () => utils.restaurantNet.listDayBookings.invalidate(), onError: (e) => toastError(e) });

  const select = (t: PlanTable) => {
    const s = states.get(t.id);
    if (s?.orderId != null) return navigate(comandaPath(s.orderId));
    if (!canWrite) return toast.info("Tu plan está en solo lectura: no se pueden abrir comandas.");
    setGuests(String(Math.min(t.capacity, 2) || 2));
    setCustomerName("");
    setOpening(t);
  };
  const roomTables = tables.filter((t) => t.roomId === roomTab);
  const seatingBooking = (bookings.data ?? []).find((b) => b.id === seating) ?? null;
  const freeTables = tables.filter((t) => t.mergedInto == null && badges.get(t.id)?.state === "libre");

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl space-y-4">
        <PageHeader
          title="Sala y comandas"
          description="Toca una mesa libre para abrir su comanda o una ocupada para seguir con ella. El cobro se registra en el TPV con su ticket."
          actions={<RestaurantPicker choice={choice} />}
        />

        {choice.list.isLoading ? (
          <PanelLoading label="Cargando los restaurantes…" />
        ) : choice.list.isError ? (
          <PanelError error={choice.list.error} onRetry={() => choice.list.refetch()} />
        ) : restaurantId == null ? (
          <NoRestaurants isAdmin={isAdmin} />
        ) : floor.isLoading ? (
          <PanelLoading label="Cargando la sala…" />
        ) : floor.isError ? (
          <PanelError error={floor.error} onRetry={() => floor.refetch()} />
        ) : tables.length === 0 ? (
          <PanelEmpty
            icon={<LayoutGrid className="h-5 w-5" />}
            title={rooms.length === 0 ? "Configura la sala para empezar" : "Esta sala aún no tiene mesas"}
            description="Crea las salas y mesas del restaurante (y su carta) para tomar comandas desde aquí."
          >
            <Button asChild><Link href={CONFIG_PATH}><Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Configurar salas y mesas</Link></Button>
            <Button asChild variant="outline"><Link href={CARTA_PATH}>Preparar la carta</Link></Button>
          </PanelEmpty>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 space-y-3" aria-label="Mesas">
              {menu.data && menu.data.length === 0 && (
                <div role="status" className="rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  La carta está vacía: <Link href={CARTA_PATH} className="font-medium underline">añade platos</Link> para poder tomar comandas.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Salas">
                  {rooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="tab"
                      aria-selected={roomTab === r.id}
                      onClick={() => setRoomTab(r.id)}
                      className={cn("rounded-lg border px-3 py-1.5 text-sm", roomTab === r.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Vista">
                  <Button size="sm" variant={view === "plano" ? "secondary" : "ghost"} aria-pressed={view === "plano"} onClick={() => setViewSaved("plano")}><MapIcon className="mr-1 h-4 w-4" aria-hidden="true" />Plano</Button>
                  <Button size="sm" variant={view === "lista" ? "secondary" : "ghost"} aria-pressed={view === "lista"} onClick={() => setViewSaved("lista")}><List className="mr-1 h-4 w-4" aria-hidden="true" />Lista</Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <StateLegend />
                <p className="text-xs text-muted-foreground">{counts.libre} libres · {counts.ocupada} ocupadas · {counts.cuenta} piden la cuenta</p>
              </div>
              {roomTables.length === 0 ? (
                <PanelEmpty icon={<LayoutGrid className="h-5 w-5" />} title="Esta sala no tiene mesas" description="Añádelas en la configuración de salas y mesas.">
                  <Button asChild variant="outline"><Link href={CONFIG_PATH}>Configurar salas y mesas</Link></Button>
                </PanelEmpty>
              ) : view === "plano" ? (
                <FloorPlan label={`Plano de ${rooms.find((r) => r.id === roomTab)?.name ?? "la sala"}`} tables={roomTables} badges={badges} onSelect={select} />
              ) : (
                <TableGrid tables={roomTables} badges={badges} onSelect={select} />
              )}
            </section>

            <aside className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="rnet-bookings-t">
              <h2 id="rnet-bookings-t" className="flex items-center gap-2 text-base font-bold text-foreground">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />Reservas de hoy
              </h2>
              {bookings.isLoading ? (
                <PanelLoading label="Cargando las reservas…" className="py-4" />
              ) : bookings.isError ? (
                <PanelError error={bookings.error} onRetry={() => bookings.refetch()} />
              ) : (bookings.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay reservas para hoy. <Link href="/admin/restaurantes" className="underline">Ver reservas</Link></p>
              ) : (
                <ul className="space-y-2">
                  {(bookings.data ?? []).map((b) => (
                    <li key={b.id} className="rounded-xl border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-foreground">{b.time} · {b.guestName || b.locator}</p>
                          <p className="text-xs text-muted-foreground">{b.guests} comensales{b.shiftName ? ` · ${b.shiftName}` : ""} · {b.locator}</p>
                          {b.allergies && <p className="mt-0.5 break-words text-xs text-warning">Alergias: {b.allergies}</p>}
                        </div>
                        {b.isVip && <Badge variant="outline">VIP</Badge>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {b.tables.map((t) => <Badge key={t.tableId} variant="secondary">Mesa {t.code}</Badge>)}
                        {b.hospoOrderId != null && b.seatedAt != null ? (
                          <Button size="sm" variant="outline" onClick={() => navigate(comandaPath(b.hospoOrderId!))}>Ver comanda</Button>
                        ) : canWrite && b.status !== "completed" && b.status !== "no_show" ? (
                          <Button size="sm" onClick={() => { setSeating(b.id); setSeatTable(b.tables[0] ? String(b.tables[0].tableId) : ""); }}>Sentar</Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{b.status === "completed" ? "Completada" : b.status === "no_show" ? "No se presentó" : ""}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        )}
      </div>

      <Dialog open={opening != null} onOpenChange={(o) => !o && setOpening(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Abrir la mesa {opening?.code}</DialogTitle>
            <DialogDescription>Capacidad: {opening?.capacity} comensales. Después añadirás los platos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rnet-open-guests">Comensales</Label>
              <Input id="rnet-open-guests" type="number" inputMode="numeric" min={1} max={50} value={guests} onChange={(e) => setGuests(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rnet-open-name">Nombre del cliente (opcional)</Label>
              <Input id="rnet-open-name" maxLength={255} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpening(null)}>Cancelar</Button>
            <Button
              disabled={openOrder.isPending}
              onClick={() => {
                const g = Number(guests);
                if (!Number.isInteger(g) || g < 1 || g > 50) return toast.error("Indica entre 1 y 50 comensales");
                openOrder.mutate({ tableId: opening!.id, guests: g, customerName: customerName || null });
              }}
            >
              Abrir comanda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={seatingBooking != null} onOpenChange={(o) => !o && setSeating(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sentar a {seatingBooking?.guestName || seatingBooking?.locator}</DialogTitle>
            <DialogDescription>Se abre la comanda de la mesa con los comensales de la reserva.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rnet-seat-table">Mesa</Label>
            <Select value={seatTable} onValueChange={setSeatTable}>
              <SelectTrigger id="rnet-seat-table"><SelectValue placeholder="Elige una mesa libre" /></SelectTrigger>
              <SelectContent>
                {[...(seatingBooking?.tables ?? []).map((t) => t.tableId), ...freeTables.map((t) => t.id)]
                  .filter((id, i, a) => a.indexOf(id) === i)
                  .map((id) => {
                    const t = tables.find((x) => x.id === id);
                    if (!t) return null;
                    const st = badges.get(id)?.state ?? "libre";
                    return <SelectItem key={id} value={String(id)}>Mesa {t.code} · {t.capacity} pax · {TABLE_STATE_LABELS[st]}</SelectItem>;
                  })}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSeating(null)}>Cancelar</Button>
            <Button
              disabled={!seatTable || seat.isPending}
              onClick={async () => {
                const tableId = Number(seatTable);
                if (seatingBooking && !seatingBooking.tables.some((t) => t.tableId === tableId)) await assign.mutateAsync({ bookingId: seatingBooking.id, tableId }).catch(() => undefined);
                seat.mutate({ bookingId: seating!, tableId });
              }}
            >
              Sentar y abrir comanda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
