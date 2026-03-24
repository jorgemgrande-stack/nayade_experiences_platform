/**
 * TpvSplitPayment — División de cuenta y pago mixto
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CreditCard, Banknote, Smartphone, Plus, Trash2, SplitSquareHorizontal, CheckCircle } from "lucide-react";

type PaymentMethod = "cash" | "card" | "bizum" | "other";

interface PaymentLine {
  id: string;
  method: PaymentMethod;
  amount: string;
  payerName: string;
}

interface CartItem {
  id: string;
  product: { id: number; title: string; productType: string };
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  eventDate?: string;
  eventTime?: string;
  participants: number;
  notes?: string;
}

interface Props {
  open: boolean;
  total: number;
  sessionId: number;
  cart: CartItem[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  discountAmount: number;
  discountReason: string;
  onClose: () => void;
  onCompleted: (sale: any) => void;
}

const METHOD_ICONS: Record<PaymentMethod, React.ReactNode> = {
  cash: <Banknote className="w-4 h-4" />,
  card: <CreditCard className="w-4 h-4" />,
  bizum: <Smartphone className="w-4 h-4" />,
  other: <CreditCard className="w-4 h-4" />,
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  other: "Otro",
};

const METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: "bg-green-700 hover:bg-green-600",
  card: "bg-blue-700 hover:bg-blue-600",
  bizum: "bg-cyan-700 hover:bg-cyan-600",
  other: "bg-gray-700 hover:bg-gray-600",
};

export default function TpvSplitPayment({
  open, total, sessionId, cart, customerName, customerEmail, customerPhone,
  discountAmount, discountReason, onClose, onCompleted,
}: Props) {
  const [payments, setPayments] = useState<PaymentLine[]>([
    { id: "1", method: "cash", amount: total.toFixed(2), payerName: "" },
  ]);

  const createSaleMut = trpc.tpv.createSale.useMutation({
    onSuccess: (data) => {
      toast.success(`Venta ${data.sale.ticketNumber} completada`);
      // Normalize: TpvTicket expects { sale: { ...saleFields, items, payments } }
      const normalized = {
        sale: {
          ...data.sale,
          items: data.items ?? [],
          payments: data.payments ?? [],
        },
      };
      onCompleted(normalized);
    },
    onError: (err) => toast.error(err.message),
  });

  const totalPaid = payments.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0);
  const remaining = total - totalPaid;
  const isValid = Math.abs(remaining) < 0.01 && payments.every((p) => parseFloat(p.amount) > 0);

  const addPayment = (method: PaymentMethod) => {
    const rem = Math.max(0, remaining);
    setPayments((prev) => [
      ...prev,
      { id: Date.now().toString(), method, amount: rem.toFixed(2), payerName: "" },
    ]);
  };

  const updatePayment = (id: string, field: keyof PaymentLine, value: string) => {
    setPayments((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const removePayment = (id: string) => {
    if (payments.length <= 1) return;
    setPayments((prev) => prev.filter((p) => p.id !== id));
  };

  const splitEvenly = (n: number) => {
    const each = (total / n).toFixed(2);
    const newPayments: PaymentLine[] = Array.from({ length: n }, (_, i) => ({
      id: (i + 1).toString(),
      method: "card" as PaymentMethod,
      amount: each,
      payerName: `Persona ${i + 1}`,
    }));
    setPayments(newPayments);
  };

  const handleConfirm = () => {
    createSaleMut.mutate({
      sessionId,
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      customerPhone: customerPhone || undefined,
      discountAmount,
      discountReason: discountReason || undefined,
      items: cart.map((item) => ({
        productType: item.product.productType as any,
        productId: item.product.id,
        productName: item.product.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountPercent: item.discountPercent,
        eventDate: item.eventDate,
        eventTime: item.eventTime,
        participants: item.participants,
        notes: item.notes,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: parseFloat(p.amount) || 0,
        payerName: p.payerName || undefined,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <SplitSquareHorizontal className="w-5 h-5 text-violet-400" />
            División de Cuenta
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* Total */}
          <div className="bg-gray-800 rounded-lg p-3 flex justify-between items-center">
            <span className="text-gray-400 text-sm">Total a cobrar</span>
            <span className="text-xl font-bold text-violet-400">{total.toFixed(2)}€</span>
          </div>

          {/* Quick split */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Dividir en:</span>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => splitEvenly(n)}
                className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded-full border border-gray-700 transition-colors"
              >
                {n} partes
              </button>
            ))}
          </div>

          {/* Payment lines */}
          <div className="space-y-2">
            {payments.map((p, idx) => (
              <div key={p.id} className="bg-gray-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Pago {idx + 1}</span>
                  {payments.length > 1 && (
                    <button onClick={() => removePayment(p.id)} className="text-gray-600 hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  {(["cash", "card", "bizum"] as PaymentMethod[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => updatePayment(p.id, "method", m)}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium text-white transition-colors ${
                        p.method === m ? METHOD_COLORS[m] : "bg-gray-700 hover:bg-gray-600"
                      }`}
                    >
                      {METHOD_ICONS[m]}
                      {METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    value={p.amount}
                    onChange={(e) => updatePayment(p.id, "amount", e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white font-bold text-lg h-9"
                    placeholder="0.00"
                  />
                  <Input
                    value={p.payerName}
                    onChange={(e) => updatePayment(p.id, "payerName", e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white h-9 text-sm"
                    placeholder="Nombre (opcional)"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add payment */}
          <div className="flex gap-2">
            {(["cash", "card", "bizum"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => addPayment(m)}
                className="flex-1 flex items-center justify-center gap-1 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-colors"
              >
                <Plus className="w-3 h-3" />
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>

          {/* Balance */}
          <div className={`flex justify-between items-center rounded-lg px-3 py-2 text-sm font-medium ${
            isValid
              ? "bg-green-900/30 text-green-400"
              : remaining > 0
              ? "bg-amber-900/30 text-amber-400"
              : "bg-red-900/30 text-red-400"
          }`}>
            <span>
              {isValid ? "Cuadrado" : remaining > 0 ? "Pendiente" : "Exceso"}
            </span>
            <span>
              {isValid ? (
                <CheckCircle className="w-4 h-4 inline" />
              ) : (
                `${remaining > 0 ? "" : "+"}${Math.abs(remaining).toFixed(2)}€`
              )}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              variant="ghost"
              className="flex-1 text-gray-400 hover:text-white border border-gray-700"
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-semibold"
              onClick={handleConfirm}
              disabled={!isValid || createSaleMut.isPending}
            >
              {createSaleMut.isPending ? "Procesando..." : "Confirmar Venta"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
