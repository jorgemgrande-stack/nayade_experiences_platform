/**
 * Diálogo «Cargar a la habitación» (Restaurant Net y Care Net con Hotel Net): elige un huésped en casa y confirma. El
 * cargo va al folio de su estancia y se cobra al cerrarlo (la factura la emite el folio): no hay venta del TPV.
 * Quien lo usa le pasa los huéspedes (su propia consulta `roomGuests`) y la acción de cargar.
 */
import { useState } from "react";
import { BedDouble, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Día AAAA-MM-DD como «10 nov». */
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });

export interface RoomGuest {
  reservationId: number;
  reservationNumber: string | null;
  guestName: string;
  roomCode: string | null;
  roomName: string | null;
  checkOut: string;
}

export function RoomChargeDialog({
  title,
  amountLabel,
  guests,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  amountLabel: string;
  guests: RoomGuest[];
  pending: boolean;
  onConfirm: (hotelReservationId: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<number | null>(null);
  const term = q.trim().toLowerCase();
  const shown = term ? guests.filter((g) => `${g.roomCode ?? ""} ${g.guestName} ${g.reservationNumber ?? ""}`.toLowerCase().includes(term)) : guests;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{amountLabel} irá al folio de la habitación y se cobrará con la factura de la estancia.</DialogDescription>
        </DialogHeader>
        {guests.length === 0 ? (
          <p className="text-sm text-foreground">No hay huéspedes en casa (con el check-in hecho) ahora mismo.</p>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Buscar habitación o huésped" placeholder="Habitación o nombre" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto" role="listbox" aria-label="Huéspedes en casa">
              {shown.map((g) => (
                <li key={g.reservationId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={chosen === g.reservationId}
                    onClick={() => setChosen(g.reservationId)}
                    className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left", chosen === g.reservationId ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
                  >
                    <BedDouble className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-medium text-foreground">{g.roomCode ? `Habitación ${g.roomCode}` : g.roomName ?? "Sin habitación asignada"} · {g.guestName}</span>
                      <span className="block text-xs text-muted-foreground">Salida {fmtDay(g.checkOut)}{g.reservationNumber ? ` · ${g.reservationNumber}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="text-sm text-muted-foreground">Ningún huésped coincide.</li>}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={chosen == null || pending} onClick={() => chosen != null && onConfirm(chosen)}>{pending ? "Cargando…" : "Cargar a la habitación"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
