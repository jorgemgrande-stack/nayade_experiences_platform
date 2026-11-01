/**
 * TpvCloseSession — Modal de cierre de caja con arqueo
 * Usa los campos exactos que devuelve el backend:
 *   getSessionSummary → { session, sales, movements, totalSales, totalOut, totalIn }
 *   closeSession → input: { sessionId, countedCash, notes? }
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { parseCashInput } from "@shared/cashAmount";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Lock, Banknote, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  sessionId: number;
  onClose: () => void;
  onClosed: () => void;
}

export default function TpvCloseSession({ open, sessionId, onClose, onClosed }: Props) {
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");

  const { data: summary } = trpc.tpv.getSessionSummary.useQuery(
    { sessionId },
    { enabled: open }
  );

  const closeMut = trpc.tpv.closeSession.useMutation({
    onSuccess: () => {
      toast.success("Caja cerrada correctamente");
      onClosed();
    },
    onError: (err) => toast.error(err.message),
  });

  // Efectivo esperado = fondo inicial + ventas cobradas en efectivo +
  //                     entradas manuales - salidas de caja.
  //
  // El desglose por método (totalCash/totalCard/totalBizum/totalMixed)
  // ahora viene del backend (getSessionSummary). Antes el frontend tenía
  // un reduce vacío con TODO ("simplificado: usamos totalSales como
  // referencia") y la fórmula omitía las ventas en efectivo, así que
  // siempre mostraba 0 € de efectivo esperado aunque hubiera cobros cash.
  const openingAmt = summary ? parseFloat(String(summary.session.openingAmount)) : 0;
  const totalCash = summary?.totalCash ?? 0;
  const totalCard = summary?.totalCard ?? 0;
  const totalBizum = summary?.totalBizum ?? 0;
  const totalIn = summary?.totalIn ?? 0;
  const totalOut = summary?.totalOut ?? 0;
  const totalSales = summary?.totalSales ?? 0;

  const expectedCash = openingAmt + totalCash + totalIn - totalOut;
  // Se escribe con coma decimal («125,50»); también vale el punto
  const counted = parseCashInput(countedCash);
  const countedInvalid = countedCash.trim() !== "" && counted === null;
  const difference = (counted ?? 0) - expectedCash;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dark bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Lock className="w-5 h-5 text-warning" />
            Cierre de Caja
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {summary && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Fondo inicial</span>
                <span>{formatEur(openingAmt)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Ventas en efectivo</span>
                <span className="text-success">+{formatEur(totalCash)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Entradas manuales</span>
                <span className="text-success">+{formatEur(totalIn)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Salidas de caja</span>
                <span className="text-danger">-{formatEur(totalOut)}</span>
              </div>
              <div className="flex justify-between font-bold text-white border-t border-gray-700 pt-2">
                <span>Efectivo esperado</span>
                <span>{formatEur(expectedCash)}</span>
              </div>
              <div className="flex justify-between text-gray-500 text-xs pt-1 border-t border-gray-800">
                <span>Cobros tarjeta</span>
                <span>{formatEur(totalCard)}</span>
              </div>
              <div className="flex justify-between text-gray-500 text-xs">
                <span>Cobros Bizum</span>
                <span>{formatEur(totalBizum)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Total ventas (todos métodos)</span>
                <span className="text-primary">{formatEur(totalSales)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Nº ventas</span>
                <span>{summary.sales.length}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="tpv-counted-cash" className="text-gray-300 text-sm">Efectivo real en caja (€)</Label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                id="tpv-counted-cash"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="pl-9 bg-gray-800 border-gray-700 text-white text-lg font-bold"
                placeholder="0,00"
                {...(countedInvalid ? { "aria-invalid": true, "aria-describedby": "tpv-counted-cash-error" } : {})}
              />
            </div>
            {countedInvalid && (
              <p id="tpv-counted-cash-error" role="alert" className="text-xs text-warning">
                Escribe el importe con coma decimal, por ejemplo 125,50.
              </p>
            )}
          </div>

          {counted !== null && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
              Math.abs(difference) < 0.01
                ? "bg-success/10 text-success"
                : "bg-warning/10 text-warning"
            }`}>
              {Math.abs(difference) >= 0.01 && <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>
                {Math.abs(difference) < 0.01
                  ? "Cuadre perfecto"
                  : `Diferencia: ${difference > 0 ? "+" : ""}${formatEur(difference)}`}
              </span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="Observaciones del cierre"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="ghost"
              className="flex-1 text-gray-400 hover:text-white border border-gray-700"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              onClick={() => {
                if (counted === null) {
                  toast.error("Escribe el efectivo que hay en la caja, por ejemplo 125,50.");
                  return;
                }
                closeMut.mutate({
                  sessionId,
                  countedCash: counted,
                  notes: notes || undefined,
                });
              }}
              disabled={closeMut.isPending}
            >
              {closeMut.isPending ? "Cerrando..." : "Cerrar Caja"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
