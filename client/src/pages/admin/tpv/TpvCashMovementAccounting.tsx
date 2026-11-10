/**
 * TpvCashMovementAccounting — Modal de entrada/salida de efectivo con la contabilidad general activa
 * (accounting-general): el cajero elige el tipo de cada movimiento, sin valor por defecto. Los motivos rápidos solo
 * rellenan el motivo: nunca fijan el tipo. Sin la licencia se usa el modal de siempre (TpvCashMovement).
 */
import { useEffect, useState } from "react";
import { newAttemptKey } from "./tpvKeys";
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

type OutKind = "gasto" | "devolucion" | "traspaso";
type InKind = "fondo" | "cobro";

// Los motivos rápidos solo rellenan el motivo: el tipo lo elige siempre el cajero
const QUICK_REASONS_OUT = ["Pago a proveedor", "Cambio de caja", "Gastos operativos", "Devolución efectivo"];
const QUICK_REASONS_IN = ["Fondo adicional", "Reposición caja", "Cobro pendiente"];

const OUT_KINDS: Array<{ kind: OutKind; label: string; hint: string; active: string }> = [
  { kind: "gasto", label: "Gasto", hint: "compra / proveedor", active: "bg-danger/10 border-danger text-danger" },
  { kind: "devolucion", label: "Devolución", hint: "a un cliente, no es gasto", active: "bg-warning/10 border-warning text-warning" },
  { kind: "traspaso", label: "Traspaso a Caja Central", hint: "no es gasto, se guarda", active: "bg-info/10 border-info text-info" },
];
const IN_KINDS: Array<{ kind: InKind; label: string; hint: string }> = [
  { kind: "fondo", label: "Fondo de caja", hint: "desde la Caja Central" },
  { kind: "cobro", label: "Cobro pendiente", hint: "de un cliente" },
];

export default function TpvCashMovementAccounting({ open, type, sessionId, onClose }: Props) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  // Clave del intento: un doble clic o un reintento no duplica el movimiento ni su apunte
  const [attemptKey, setAttemptKey] = useState(newAttemptKey);
  // TPV Advanced: número de la autorización de un supervisor, si la regla de la empresa la pide
  const [authId, setAuthId] = useState("");
  const advanced = trpc.tpv.planInfo.useQuery(undefined, { retry: false, staleTime: 60_000 }).data?.advanced === true;
  useEffect(() => { if (open) { setAttemptKey(newAttemptKey()); setAuthId(""); } }, [open]);
  // Salidas: "gasto" (compra/proveedor), "devolucion" (a un cliente) o "traspaso" (a Caja Central). Sin valor por
  // defecto: una devolución registrada como gasto inventaba un gasto en la contabilidad.
  const [outKind, setOutKind] = useState<OutKind | null>(null);
  const [inKind, setInKind] = useState<InKind | null>(null);

  const movMut = trpc.tpv.addCashMovement.useMutation({
    onSuccess: () => {
      toast.success(
        type === "in" ? "Entrada registrada"
          : outKind === "traspaso" ? "Traspaso a Caja Central registrado"
          : outKind === "devolucion" ? "Devolución registrada"
          : "Salida registrada",
      );
      setAmount("");
      setReason("");
      setOutKind(null);
      setInKind(null);
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const quickReasons = type === "out" ? QUICK_REASONS_OUT : QUICK_REASONS_IN;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="dark bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            {type === "in" ? (
              <ArrowDownLeft className="w-5 h-5 text-success" />
            ) : (
              <ArrowUpRight className="w-5 h-5 text-danger" />
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

          {type === "out" && (
            <div className="space-y-1">
              <Label className="text-gray-300 text-sm">Tipo de salida</Label>
              <div className="grid grid-cols-3 gap-2">
                {OUT_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setOutKind(k.kind)}
                    className={`text-xs font-semibold px-2 py-2.5 rounded-lg border transition-colors ${
                      outKind === k.kind ? k.active : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {k.label}
                    <span className="block text-[10px] font-normal opacity-70">{k.hint}</span>
                  </button>
                ))}
              </div>
              {outKind === null && <p className="text-[11px] text-gray-400 pt-1">Elige el tipo de salida.</p>}
              {outKind === "devolucion" && (
                <p className="text-[11px] text-warning pt-1">
                  Devuelve efectivo a un cliente (venta anulada o devuelta). No cuenta como gasto.
                </p>
              )}
              {outKind === "traspaso" && (
                <p className="text-[11px] text-info pt-1">
                  El efectivo sale del cajón pero se conserva en la Caja Central. No cuenta como gasto.
                </p>
              )}
            </div>
          )}

          {type === "in" && (
            <div className="space-y-1">
              <Label className="text-gray-300 text-sm">Tipo de entrada</Label>
              <div className="grid grid-cols-2 gap-2">
                {IN_KINDS.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setInKind(k.kind)}
                    className={`text-xs font-semibold px-2 py-2.5 rounded-lg border transition-colors ${
                      inKind === k.kind ? "bg-success/10 border-success text-success" : "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                    }`}
                  >
                    {k.label}
                    <span className="block text-[10px] font-normal opacity-70">{k.hint}</span>
                  </button>
                ))}
              </div>
              {inKind === null && <p className="text-[11px] text-gray-400 pt-1">Elige el tipo de entrada.</p>}
            </div>
          )}

          <div className="space-y-1">
            {advanced && type === "out" && (
              <div className="space-y-1">
                <Label className="text-gray-300 text-sm">Autorización (si te la piden)</Label>
                <Input inputMode="numeric" value={authId} onChange={(e) => setAuthId(e.target.value.replace(/\D/g, ""))} placeholder="Nº de autorización" className="bg-gray-800 border-gray-700 text-white" />
              </div>
            )}
            <Label className="text-gray-300 text-sm">Motivo</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="Describe el motivo..."
            />
            <div className="flex flex-wrap gap-1 pt-1">
              {quickReasons.map((q) => (
                <button
                  key={q}
                  onClick={() => setReason(q)}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-full border border-gray-700 transition-colors"
                >
                  {q}
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
              className={`flex-1 font-semibold ${
                type === "in"
                  ? "bg-primary hover:bg-primary/90 text-primary-foreground"
                  : "bg-destructive hover:bg-destructive/90 text-white"
              }`}
              onClick={() =>
                movMut.mutate({
                  sessionId,
                  type,
                  idempotencyKey: attemptKey,
                  ...(authId ? { authorizationId: Number(authId) } : {}),
                  amount: parseFloat(amount) || 0,
                  reason: reason || (type === "out" && outKind === "traspaso" ? "Traspaso a Caja Central" : "Sin motivo"),
                  ...(type === "out" ? { outKind: outKind ?? undefined } : { inKind: inKind ?? undefined }),
                })
              }
              disabled={movMut.isPending || !amount || parseFloat(amount) <= 0 || (type === "out" ? outKind === null : inKind === null)}
            >
              {movMut.isPending ? "Guardando..." : "Registrar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
