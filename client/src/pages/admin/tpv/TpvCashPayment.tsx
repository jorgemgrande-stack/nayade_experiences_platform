/**
 * TpvCashPayment — Cobro en efectivo con importe entregado y cambio (M6).
 *
 * Antes, «Efectivo» cobraba al instante. Ahora se pide lo que entrega el cliente (con atajos: importe exacto y los
 * billetes que lo cubren), se muestra el cambio y solo entonces se cobra. La venta usa la misma clave de intento que
 * el resto de cobros de la pantalla: un doble clic o un reintento del mismo carrito no graba dos ventas.
 */
import { useEffect, useState } from "react";
import { formatEur } from "@shared/creditNoteForm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Banknote, Loader2 } from "lucide-react";
import { canChargeCash, cashChange, parseTendered, quickTenders } from "./tpvScreenLogic";

export default function TpvCashPayment({
  open,
  total,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  total: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: (amountTendered: number) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const tendered = parseTendered(text);
  const ok = canChargeCash(total, tendered);
  const change = cashChange(total, tendered);
  const short = tendered !== null && !ok;

  const confirm = () => {
    if (ok && tendered !== null && !pending) onConfirm(tendered);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !pending && onClose()}>
      <DialogContent className="dark bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Banknote className="w-5 h-5 text-primary" />
            Cobro en efectivo
          </DialogTitle>
          <DialogDescription className="text-gray-300">Indica lo que te entrega el cliente para calcular el cambio.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <div className="bg-gray-800 rounded-lg p-3 flex justify-between items-center">
            <span className="text-gray-300 text-sm">Total a cobrar</span>
            <span className="text-xl font-bold text-white" data-testid="efectivo-total">{formatEur(total)}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpv-entregado" className="text-gray-200">Importe entregado</Label>
            <Input
              id="tpv-entregado"
              autoFocus
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-invalid={short || undefined}
              aria-describedby="tpv-entregado-ayuda"
              className="h-12 text-lg bg-gray-800 border-gray-600 text-white"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {quickTenders(total).map((v, i) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setText(v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                  className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-100 px-3 py-1.5 rounded-full border border-gray-600 transition-colors"
                >
                  {i === 0 ? `Exacto (${formatEur(v)})` : formatEur(v)}
                </button>
              ))}
            </div>
          </div>

          <div
            id="tpv-entregado-ayuda"
            role="status"
            className={`rounded-lg p-3 flex justify-between items-center font-semibold border ${
              ok ? "bg-success/10 text-success border-success/40" : short ? "bg-warning/10 text-warning border-warning/40" : "bg-gray-800 text-gray-300 border-gray-700"
            }`}
          >
            <span>{ok ? "Cambio" : short ? "Falta" : "Cambio"}</span>
            <span className="text-lg" data-testid="efectivo-cambio">
              {ok ? formatEur(change) : short && tendered !== null ? formatEur(total - tendered) : "—"}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="ghost" className="flex-1 text-gray-200 hover:text-white border border-gray-600" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" disabled={!ok || pending}>
              {pending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cobrando...</> : "Cobrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
