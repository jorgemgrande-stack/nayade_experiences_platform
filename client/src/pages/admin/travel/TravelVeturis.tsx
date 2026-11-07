/**
 * Travel Net · Veturis: ajustes de la integración (proveedor que la representa, reserva real e inventario, los dos
 * apagados por defecto) con los hoteles de Veturis de la empresa, y búsqueda desde un expediente para añadir una oferta
 * con su coste neto (el PVP lo calcula el margen de Travel Net). Las credenciales se guardan en Ajustes → Integraciones.
 */
import { useState } from "react";
import { Link } from "wouter";
import { BedDouble, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { eur } from "./travelShared";

const errorToast = (e: { message: string }) => toast.error(e.message);

export function VeturisSettingsCard({ suppliers }: { suppliers: Array<{ id: number; name: string; fiscalName: string }> }) {
  const utils = trpc.useUtils();
  const st = trpc.travel.veturisStatus.useQuery(undefined, { retry: false });
  const hotels = trpc.travel.veturisHotels.useQuery(undefined, { retry: false });
  const [hotelId, setHotelId] = useState("");
  const [name, setName] = useState("");
  const refresh = () => utils.travel.invalidate();
  const save = trpc.travel.veturisSaveSettings.useMutation({ onSuccess: () => (toast.success("Ajustes de Veturis guardados"), refresh()), onError: errorToast });
  const add = trpc.travel.veturisAddHotel.useMutation({ onSuccess: () => (toast.success("Hotel añadido"), setHotelId(""), setName(""), refresh()), onError: errorToast });
  const toggle = trpc.travel.veturisSetHotelActive.useMutation({ onSuccess: refresh, onError: errorToast });
  if (st.error) return null;
  const s = st.data;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <BedDouble className="h-4 w-4" aria-hidden="true" /> Veturis (alojamiento)
          {s && (s.connected ? <Badge variant="outline">{s.environment === "live" ? "Real" : "Pruebas"}</Badge> : <Badge variant="secondary">Sin conectar</Badge>)}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {s && !s.connected && (
          <p className="text-muted-foreground">
            Conecta tu cuenta de agencia de Veturis en <Link href="/admin/configuracion/integraciones" className="underline">Ajustes → Integraciones</Link>. Hasta entonces no se llama a Veturis.
          </p>
        )}
        {s && (
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="vt-sup">Proveedor que representa a Veturis</Label>
              <select id="vt-sup" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={s.supplierId ?? ""} onChange={(e) => save.mutate({ supplierId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Elige un proveedor</option>
                {suppliers.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name || x.fiscalName}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2">
              <Switch checked={s.bookingEnabled} disabled={save.isPending || !s.supplierId} onCheckedChange={(on) => save.mutate({ bookingEnabled: on })} aria-label="Reserva en Veturis" />
              Reservar en Veturis al enviar la operación
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={s.inventoryEnabled} disabled={save.isPending} onCheckedChange={(on) => save.mutate({ inventoryEnabled: on })} aria-label="Comprobación de inventario" />
              Comprobar disponibilidad cada día
            </label>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Con la reserva apagada (por defecto), la operación se gestiona a mano como con cualquier proveedor. Antes de reservar se revalida siempre el precio: si cambió, no se reserva.</p>
        <div className="space-y-2">
          <p className="font-medium">Hoteles de Veturis con los que trabajas</p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ hotelId, name, destination: null });
            }}
          >
            <Input aria-label="Identificador del hotel en Veturis" placeholder="ID de Veturis" className="w-32" inputMode="numeric" value={hotelId} onChange={(e) => setHotelId(e.target.value.replace(/\D/g, ""))} />
            <Input aria-label="Nombre del hotel" placeholder="Nombre" className="w-60" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <Button size="sm" type="submit" disabled={!hotelId || name.trim().length < 2 || add.isPending}>
              Añadir
            </Button>
          </form>
          {(hotels.data ?? []).length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {hotels.data!.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 break-words">
                    {h.name} <span className="text-xs text-muted-foreground">· {h.hotelId}</span>
                    {h.lastAvailable != null && <span className="text-xs text-muted-foreground"> · {h.lastAvailable ? "con disponibilidad" : "sin disponibilidad"} en la última comprobación</span>}
                  </span>
                  <Switch checked={h.active} onCheckedChange={(on) => toggle.mutate({ id: h.id, active: on })} aria-label={`Activo: ${h.name}`} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function VeturisSearchDialog({ file, onClose }: { file: { id: number; startDate: string | null; endDate: string | null; adults: number }; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [checkIn, setCheckIn] = useState(file.startDate ?? "");
  const [checkOut, setCheckOut] = useState(file.endDate ?? "");
  const [adults, setAdults] = useState(String(Math.min(9, Math.max(1, file.adults || 2))));
  const [rooms, setRooms] = useState("1");
  const [asked, setAsked] = useState<null | { checkIn: string; checkOut: string; rooms: Array<{ adults: number; childrenAges: number[] }> }>(null);
  const q = trpc.travel.veturisSearch.useQuery(asked ?? { checkIn: "2000-01-01", checkOut: "2000-01-02", rooms: [{ adults: 1, childrenAges: [] }] }, { enabled: !!asked, retry: false });
  const add = trpc.travel.veturisAddOffer.useMutation({
    onSuccess: (r) => {
      toast.success(r.priceChanged ? `Añadido con el precio actualizado: ${eur(r.netCents)} de coste` : `Añadido: ${eur(r.netCents)} de coste`);
      void utils.travel.getFile.invalidate({ id: file.id });
      void utils.travel.veturisFileOffers.invalidate();
      onClose();
    },
    onError: errorToast,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Buscar alojamiento en Veturis</DialogTitle>
          <DialogDescription>Precios de coste de tu agencia (sin margen). Al añadir una oferta se confirma su precio con Veturis y Travel Net le aplica tu margen.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem_6rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.max(1, Math.min(9, Number(rooms) || 1));
            setAsked({ checkIn, checkOut, rooms: Array.from({ length: n }, () => ({ adults: Math.max(1, Math.min(9, Number(adults) || 1)), childrenAges: [] })) });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="vt-in">Entrada</Label>
            <Input id="vt-in" type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vt-out">Salida</Label>
            <Input id="vt-out" type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vt-rooms">Habitaciones</Label>
            <Input id="vt-rooms" type="number" min={1} max={9} value={rooms} onChange={(e) => setRooms(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vt-ad">Adultos/hab.</Label>
            <Input id="vt-ad" type="number" min={1} max={9} value={adults} onChange={(e) => setAdults(e.target.value)} />
          </div>
          <Button type="submit">
            <Search className="mr-1 h-4 w-4" aria-hidden="true" /> Buscar
          </Button>
        </form>
        {asked && q.isLoading && (
          <p className="text-sm text-muted-foreground">
            <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" /> Consultando Veturis…
          </p>
        )}
        {asked && q.error && <p className="text-sm text-destructive">{q.error.message}</p>}
        {asked && q.data && (q.data.hotels.every((h) => !h.offers.length) ? (
          <p className="text-sm text-muted-foreground">Sin disponibilidad en tus hoteles de Veturis para esas fechas.</p>
        ) : (
          <div className="space-y-3">
            {q.data.hotels
              .filter((h) => h.offers.length)
              .map((h) => (
                <div key={h.hotelId} className="space-y-2 rounded-lg border border-border p-3">
                  <p className="font-medium">{h.name}</p>
                  <ul className="space-y-1 text-sm">
                    {h.offers.map((o) => (
                      <li key={o.offerToken} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 break-words">
                          {o.roomName} · {o.refundable === "yes" ? "Reembolsable" : o.refundable === "no" ? "No reembolsable" : "Reembolso sin indicar"}
                          {o.cancellationFrom ? ` · gastos desde ${o.cancellationFrom}` : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{eur(o.netCents)}</span>
                          <Button
                            size="sm"
                            disabled={add.isPending}
                            onClick={() => add.mutate({ fileId: file.id, searchObj: q.data!.searchObj, offerToken: o.offerToken, hotelId: h.hotelId, checkIn: asked.checkIn, checkOut: asked.checkOut, rooms: asked.rooms, refundable: o.refundable })}
                          >
                            Añadir
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        ))}
      </DialogContent>
    </Dialog>
  );
}

/** Marca y revalidación de los servicios de un expediente que vienen de Veturis. */
export function useVeturisOffers(fileId: number) {
  const utils = trpc.useUtils();
  const q = trpc.travel.veturisFileOffers.useQuery({ fileId }, { retry: false });
  const revalidate = trpc.travel.veturisRevalidate.useMutation({
    onSuccess: (r) => {
      if (r.changed) toast.warning(`El precio ha cambiado: ${eur(r.previousNetCents)} → ${eur(r.netCents)} de coste${r.serviceUpdated ? "" : " (el presupuesto ya está aceptado: revísalo con el cliente)"}`);
      else toast.success("Precio confirmado con Veturis");
      void utils.travel.getFile.invalidate({ id: fileId });
      void q.refetch();
    },
    onError: errorToast,
  });
  const byService = new Map((q.data ?? []).map((o) => [o.serviceId, o]));
  return { byService, revalidate };
}
