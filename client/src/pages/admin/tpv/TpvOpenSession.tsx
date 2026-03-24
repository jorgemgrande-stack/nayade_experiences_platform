/**
 * TpvOpenSession — Modal de apertura de caja
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Banknote, Lock } from "lucide-react";

interface Props {
  open: boolean;
  registerId: number;
  onClose: () => void;
  onOpened: (sessionId: number) => void;
}

export default function TpvOpenSession({ open, registerId, onClose, onOpened }: Props) {
  const [openingAmount, setOpeningAmount] = useState("0");
  const [notes, setNotes] = useState("");

  const openMut = trpc.tpv.openSession.useMutation({
    onSuccess: (session) => {
      toast.success("Caja abierta correctamente");
      onOpened(session.id);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleOpen = () => {
    openMut.mutate({
      registerId,
      openingAmount: parseFloat(openingAmount) || 0,
      notes: notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Lock className="w-5 h-5 text-violet-400" />
            Apertura de Caja
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Fondo inicial en caja (€)</Label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                type="number"
                step="0.01"
                min="0"
                value={openingAmount}
                onChange={(e) => setOpeningAmount(e.target.value)}
                className="pl-9 bg-gray-800 border-gray-700 text-white text-lg font-bold"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-gray-300 text-sm">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
              placeholder="Ej: Turno de mañana"
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
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold"
              onClick={handleOpen}
              disabled={openMut.isPending}
            >
              {openMut.isPending ? "Abriendo..." : "Abrir Caja"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
