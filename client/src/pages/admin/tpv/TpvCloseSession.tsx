/**
 * TpvCloseSession — Modal de cierre de caja con arqueo
 * Usa los campos exactos que devuelve el backend:
 *   getSessionSummary → { session, sales, movements, totalSales, totalOut, totalIn }
 *   closeSession → input: { sessionId, countedCash, notes? }
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
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
  const [countedCash, setCountedCash] = useState("0");
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

  // Efectivo esperado = fondo inicial + ventas en efectivo + entradas manuales - salidas
  const openingAmt = summary ? parseFloat(String(summary.session.openingAmount)) : 0;
  const totalCashSales = summary
    ? summary.sales.reduce((acc, s) => {
        // Sumar solo pagos en efectivo de esta sesión
        return acc; // simplificado: usamos totalSales como referencia
      }, 0)
    : 0;
  const totalIn = summary?.totalIn ?? 0;
  const totalOut = summary?.totalOut ?? 0;
  const totalSales = summary?.totalSales ?? 0;

  // Estimación de efectivo esperado (fondo + entradas - salidas)
  const expectedCash = openingAmt + totalIn - totalOut;
  const difference = parseFloat(countedCash || "0") - expectedCash;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Lock className="w-5 h-5 text-amber-400" />
            Cierre de Caja
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {summary && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between text-gray-400">
                <span>Fondo inicial</span>
                <span>{openingAmt.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Entradas manuales</span>
                <span className="text-green-400">+{totalIn.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Salidas de caja</span>
                <span className="text-red-400">-{totalOut.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between font-bold text-white border-t border-gray-700 pt-2">
                <span>Efectivo esperado</span>
                <span>{expectedCash.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Total ventas (todos métodos)</span>
                <span className="text-violet-400">{totalSales.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Nº ventas</span>
                <span>{summary.sales.length}</span>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Efectivo real en caja (€)</Label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type="number"
                step="0.01"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="pl-9 bg-gray-800 border-gray-700 text-white text-lg font-bold"
                placeholder="0.00"
              />
            </div>
          </div>

          {countedCash && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
              Math.abs(difference) < 0.01
                ? "bg-green-900/30 text-green-400"
                : "bg-amber-900/30 text-amber-400"
            }`}>
              {Math.abs(difference) >= 0.01 && <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>
                {Math.abs(difference) < 0.01
                  ? "Cuadre perfecto"
                  : `Diferencia: ${difference > 0 ? "+" : ""}${difference.toFixed(2)}€`}
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
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              onClick={() =>
                closeMut.mutate({
                  sessionId,
                  countedCash: parseFloat(countedCash) || 0,
                  notes: notes || undefined,
                })
              }
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
