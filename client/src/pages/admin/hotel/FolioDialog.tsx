import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Receipt, Trash2 } from "lucide-react";
import { PmsNotInstalled, eur, isPmsNotInstalled, shortDate } from "./pmsShared";

const CHARGE_CATEGORIES = [
  { value: "extra", label: "Extra" },
  { value: "restaurante", label: "Restaurante" },
  { value: "spa", label: "Spa" },
  { value: "minibar", label: "Minibar" },
  { value: "otro", label: "Otro" },
] as const;
const PAYMENT_METHODS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "transferencia", label: "Transferencia" },
  { value: "otro", label: "Otro" },
] as const;
const LABEL: Record<string, string> = {
  alojamiento: "Alojamiento", extra: "Extra", restaurante: "Restaurante", spa: "Spa", minibar: "Minibar", otro: "Otro",
  efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", pago_reserva: "Pago de la reserva",
};

/** Euros escritos («12,50») a céntimos; NaN si no es un importe. */
const toCents = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

export default function FolioDialog({ reservationId, onClose }: { reservationId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.hotel.adminGetFolio.useQuery({ reservationId }, { retry: (n, e) => !isPmsNotInstalled(e) && n < 2 });
  const refresh = () => { void utils.hotel.adminGetFolio.invalidate({ reservationId }); void utils.hotel.adminListReservations.invalidate(); };
  const onError = (e: { message: string }) => toast.error(e.message);
  const addCharge = trpc.hotel.adminAddFolioCharge.useMutation({ onSuccess: () => { toast.success("Cargo añadido"); refresh(); setDesc(""); setPrice(""); setQty(1); }, onError });
  const addPayment = trpc.hotel.adminAddFolioPayment.useMutation({ onSuccess: () => { toast.success("Pago registrado"); refresh(); setPayAmount(""); }, onError });
  const del = trpc.hotel.adminDeleteFolioItem.useMutation({ onSuccess: refresh, onError });
  const close = trpc.hotel.adminCloseFolio.useMutation({
    onSuccess: (r) => { toast.success(r.invoiceNumber ? `Folio cerrado · factura ${r.invoiceNumber}` : "Folio cerrado sin cargos"); refresh(); void utils.hotel.adminGetReceptionDashboard.invalidate(); },
    onError,
  });

  const [category, setCategory] = useState<(typeof CHARGE_CATEGORIES)[number]["value"]>("extra");
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [tax, setTax] = useState("2100");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("tarjeta");
  const [payAmount, setPayAmount] = useState("");
  const [nif, setNif] = useState("");
  const [address, setAddress] = useState("");
  const [billName, setBillName] = useState("");

  const d = q.data;
  const closed = d?.folio.status === "cerrado";
  const editable = d && !d.editBlocker;
  const busy = addCharge.isPending || addPayment.isPending || del.isPending || close.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Receipt className="h-5 w-5" /> Folio{d ? ` · ${d.reservation.reservationNumber ?? d.reservation.id}` : ""}
            {closed && <Badge variant="secondary">Cerrado{d?.folio.invoiceNumber ? ` · factura ${d.folio.invoiceNumber}` : ""}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {isPmsNotInstalled(q.error) ? (
          <PmsNotInstalled />
        ) : q.isLoading ? (
          <p className="text-sm text-muted-foreground py-6">Cargando…</p>
        ) : q.error ? (
          <p className="text-sm text-destructive py-6">{q.error.message}</p>
        ) : d && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {d.reservation.customerName} · {d.reservation.roomName} · {shortDate(d.reservation.checkIn)} → {shortDate(d.reservation.checkOut)}
            </p>
            {d.reservation.invoiceNumber && !closed && (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                El alojamiento ya está facturado en {d.reservation.invoiceNumber} (pago web): este folio recoge solo los extras.
              </div>
            )}
            {!d.items.length && (
              <p className="text-sm text-muted-foreground">
                Sin movimientos. El alojamiento se carga al hacer el check-in; añade aquí los extras y los pagos de la estancia.
              </p>
            )}
            {d.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[520px]">
                  <thead className="border-b border-border bg-muted/40 text-left">
                    <tr><th className="p-2 font-medium">Concepto</th><th className="p-2 font-medium">Cant.</th><th className="p-2 font-medium">IVA</th><th className="p-2 font-medium text-right">Importe</th><th className="p-2" /></tr>
                  </thead>
                  <tbody>
                    {d.items.map((it) => (
                      <tr key={it.id} className="border-b border-border last:border-0">
                        <td className="p-2">
                          <div>{it.description ?? LABEL[it.category] ?? it.category}</div>
                          <div className="text-xs text-muted-foreground">{it.kind === "pago" ? "Pago" : "Cargo"} · {LABEL[it.category] ?? it.category}</div>
                        </td>
                        <td className="p-2">{it.kind === "cargo" ? it.quantity : ""}</td>
                        <td className="p-2">{it.kind === "cargo" && it.taxRateBp != null ? `${it.taxRateBp / 100} %` : ""}</td>
                        <td className={`p-2 text-right whitespace-nowrap ${it.kind === "pago" ? "text-emerald-700 dark:text-emerald-400" : ""}`}>{it.kind === "pago" ? "−" : ""}{eur(it.amountCents)}</td>
                        <td className="p-2 text-right">
                          {editable && !it.automatic && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del.mutate({ reservationId, itemId: it.id })} disabled={busy} aria-label="Borrar"><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm border-t border-border pt-2">
              <span>Cargos: <b>{eur(d.totals.chargesCents)}</b></span>
              <span>Pagos: <b className="text-emerald-700 dark:text-emerald-400">{eur(d.totals.paymentsCents)}</b></span>
              <span>Saldo: <b className={d.totals.balanceCents !== 0 ? "text-amber-700 dark:text-amber-400" : ""}>{eur(d.totals.balanceCents)}</b></span>
            </div>

            {editable && (
              <>
                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Añadir cargo</div>
                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
                    <div className="space-y-1 sm:col-span-1">
                      <Label className="text-xs">Tipo</Label>
                      <Select value={category} onValueChange={(v) => setCategory(v as typeof category)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{CHARGE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 col-span-2 sm:col-span-2"><Label className="text-xs">Concepto</Label><Input value={desc} maxLength={255} onChange={(e) => setDesc(e.target.value)} placeholder="Cena, lavandería…" /></div>
                    <div className="space-y-1"><Label className="text-xs">Cantidad</Label><Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))} /></div>
                    <div className="space-y-1"><Label className="text-xs">Precio (€, IVA incl.)</Label><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
                    <div className="space-y-1">
                      <Label className="text-xs">IVA</Label>
                      <Select value={tax} onValueChange={setTax}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="2100">21 %</SelectItem><SelectItem value="1000">10 %</SelectItem><SelectItem value="400">4 %</SelectItem><SelectItem value="0">0 %</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => {
                    const c = toCents(price);
                    if (!desc.trim()) return toast.error("Indica el concepto");
                    if (!Number.isFinite(c) || c <= 0) return toast.error("Importe no válido");
                    addCharge.mutate({ reservationId, category, description: desc.trim(), quantity: qty, unitPriceCents: c, taxRateBp: Number(tax) });
                  }}>Añadir cargo</Button>
                </div>

                <div className="rounded-md border border-border p-3 flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Pago</Label>
                    <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                      <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Importe (€)</Label><Input inputMode="decimal" className="w-32" value={payAmount} placeholder={d.totals.balanceCents > 0 ? (d.totals.balanceCents / 100).toFixed(2) : ""} onChange={(e) => setPayAmount(e.target.value)} /></div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                    const c = payAmount.trim() === "" ? d.totals.balanceCents : toCents(payAmount);
                    if (!Number.isFinite(c) || c <= 0) return toast.error("Importe no válido");
                    addPayment.mutate({ reservationId, method, amountCents: c });
                  }}>Registrar pago</Button>
                </div>

                <div className="rounded-md border border-border p-3 space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Datos de la factura (opcional)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input value={billName} maxLength={256} onChange={(e) => setBillName(e.target.value)} placeholder={d.reservation.customerName} aria-label="Nombre o razón social" />
                    <Input value={nif} maxLength={32} onChange={(e) => setNif(e.target.value)} placeholder="NIF / CIF" aria-label="NIF" />
                    <Input value={address} maxLength={500} onChange={(e) => setAddress(e.target.value)} placeholder="Dirección fiscal" aria-label="Dirección" />
                  </div>
                  {d.closeBlocker && <p className="text-xs text-amber-700 dark:text-amber-400">{d.closeBlocker}</p>}
                </div>
              </>
            )}
            {d.editBlocker && !closed && <p className="text-sm text-muted-foreground">{d.editBlocker}</p>}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar ventana</Button>
          {d && editable && (
            <Button disabled={busy || !!d.closeBlocker} onClick={() => close.mutate({ reservationId, clientName: billName || undefined, clientNif: nif || undefined, clientAddress: address || undefined })}>
              {close.isPending ? "Cerrando…" : "Cerrar folio y facturar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
