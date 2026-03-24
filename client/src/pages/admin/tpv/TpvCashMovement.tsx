/**
 * TpvCashMovement — Modal de entrada/salida de efectivo
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Banknote } from "lucide-react";

interface Props {
  open: boolean;
  type: "in" | "out";
  sessionId: number;
  onClose: () => void;
}

const QUICK_REASONS_OUT = [
  "Pago a proveedor",
  "Cambio de caja",
  "Gastos operativos",
  "Devolución efectivo",
];
const QUICK_REASONS_IN = [
  "Fondo adicional",
  "Reposición caja",
  "Cobro pendiente",
];

export default function TpvCashMovement({ open, type, sessionId, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const movMut = trpc.tpv.addCashMovement.useMutation({
    onSuccess: () => {
      toast.success(type === "in" ? "Entrada registrada" : "Salida registrada");
      setAmount("");
      setReason("");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const quickReasons = type === "out" ? QUICK_REASONS_OUT : QUICK_REASONS_IN;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            {type === "in" ? (
              <ArrowDownLeft className="w-5 h-5 text-green-400" />
            ) : (
              <ArrowUpRight className="w-5 h-5 text-red-400" />
            )}
            {type === "in" ? "Entrada de Efectivo" : "Salida de Efectivo"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Importe (€)</Label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-9 bg-gray-800 border-gray-700 text-white text-lg font-bold"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Motivo</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="Describe el motivo..."
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {quickReasons.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-full border border-gray-700 transition-colors"
                >
                  {r}
                </button>
              ))}
            </div>
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
              className={`flex-1 font-semibold text-white ${
                type === "in"
                  ? "bg-green-700 hover:bg-green-600"
                  : "bg-red-700 hover:bg-red-600"
              }`}
              onClick={() =>
                movMut.mutate({
                  sessionId,
                  type,
                  amount: parseFloat(amount) || 0,
                  reason: reason || "Sin motivo",
                })
              }
              disabled={movMut.isPending || !amount || parseFloat(amount) <= 0}
            >
              {movMut.isPending ? "Guardando..." : "Registrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
