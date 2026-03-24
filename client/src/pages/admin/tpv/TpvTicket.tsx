/**
 * TpvTicket — Ticket térmico 80mm con impresión, email y nueva venta
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Printer, Mail, MessageSquare, ShoppingCart, X } from "lucide-react";

interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: string | number;
  discountPercent: string | number;
  lineTotal: string | number;
}

interface SalePayment {
  method: string;
  amount: string | number;
  payerName?: string | null;
}

interface Sale {
  ticketNumber: string;
  createdAt: string | Date;
  customerName?: string | null;
  customerEmail?: string | null;
  subtotal: string | number;
  discountAmount: string | number;
  total: string | number;
  items: SaleItem[];
  payments: SalePayment[];
  // Campos fiscales (opcionales para compatibilidad)
  taxBase?: string | number | null;
  taxAmount?: string | number | null;
  taxRate?: string | number | null;
  reavMargin?: string | number | null;
  reavCost?: string | number | null;
  reavTax?: string | number | null;
  fiscalSummary?: string | null;
  sellerName?: string | null;
  reservationId?: number | null;
}

interface Props {
  open: boolean;
  sale: { sale: Sale };
  onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  bizum: "Bizum",
  other: "Otro",
};

export default function TpvTicket({ open, sale, onClose }: Props) {
  const [emailInput, setEmailInput] = useState(sale.sale.customerEmail ?? "");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const ticketRef = useRef<HTMLDivElement>(null);

  const sendEmailMut = trpc.tpv.sendTicketEmail.useMutation({
    onSuccess: () => toast.success("Ticket enviado por email"),
    onError: (err) => toast.error(err.message),
  });

  const s = sale.sale;
  // Ensure arrays are always defined to prevent .map() crashes
  const saleItems = (s as any).items ?? [];
  const salePayments = (s as any).payments ?? [];
  const date = new Date(s.createdAt);
  const dateStr = date.toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
  });

  const handlePrint = () => {
    const printContent = ticketRef.current?.innerHTML;
    if (!printContent) return;
    const win = window.open("", "_blank", "width=320,height=600");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ticket ${s.ticketNumber}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 11px; width: 80mm; padding: 4mm; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .line { border-top: 1px dashed #000; margin: 3px 0; }
          .row { display: flex; justify-content: space-between; }
          .total { font-size: 14px; font-weight: bold; }
        </style>
      </head>
      <body>${printContent}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  };

  const handleSendEmail = () => {
    if (!emailInput) return toast.error("Introduce un email");
    sendEmailMut.mutate({
      ticketNumber: s.ticketNumber,
      email: emailInput,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-white">
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-green-400" />
              Venta completada
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Ticket preview */}
        <div className="bg-white rounded-lg p-4 text-black font-mono text-xs overflow-auto max-h-80">
          <div ref={ticketRef}>
            <div className="center bold text-sm">NÁYADE EXPERIENCES</div>
            <div className="center text-xs">Skicenter · Sierra Nevada</div>
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="center" style={{ fontSize: "9px", color: "#555" }}>NEXTAIR, S.L. · CIF: B16408031</div>
            <div className="center" style={{ fontSize: "9px", color: "#555" }}>C/JOSE LUIS PEREZ PUJADAS, Nº 14, PLTA.1, PUERTA D</div>
            <div className="center" style={{ fontSize: "9px", color: "#555" }}>EDIFICIO FORUM · 18006 GRANADA</div>
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row">
              <span>{dateStr} {timeStr}</span>
              <span className="bold">{s.ticketNumber}</span>
            </div>
            {s.customerName && (
              <div>Cliente: {s.customerName}</div>
            )}
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {saleItems.map((item: any, i: number) => (
              <div key={i}>
                <div className="bold">{item.productName}</div>
                <div className="row">
                  <span>{item.quantity} x {parseFloat(String(item.unitPrice)).toFixed(2)}€</span>
                  <span>{parseFloat(String(item.lineTotal)).toFixed(2)}€</span>
                </div>
                {parseFloat(String(item.discountPercent)) > 0 && (
                  <div style={{ color: "#666" }}>
                    Dto. {parseFloat(String(item.discountPercent)).toFixed(0)}%
                  </div>
                )}
              </div>
            ))}
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row">
              <span>Subtotal</span>
              <span>{parseFloat(String(s.subtotal)).toFixed(2)}€</span>
            </div>
            {parseFloat(String(s.discountAmount)) > 0 && (
              <div className="row">
                <span>Descuento</span>
                <span>-{parseFloat(String(s.discountAmount)).toFixed(2)}€</span>
              </div>
            )}
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row total">
              <span>TOTAL</span>
              <span>{parseFloat(String(s.total)).toFixed(2)}€</span>
            </div>
            {/* Desglose fiscal */}
            {(s.taxBase || s.reavMargin) && (
              <>
                <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
                <div style={{ fontSize: "8px", color: "#555" }}>
                  {s.fiscalSummary !== "reav_only" && s.taxBase && parseFloat(String(s.taxBase)) > 0 && (
                    <div className="row">
                      <span>Base imponible IVA {s.taxRate ?? 21}%</span>
                      <span>{parseFloat(String(s.taxBase)).toFixed(2)}€</span>
                    </div>
                  )}
                  {s.fiscalSummary !== "reav_only" && s.taxAmount && parseFloat(String(s.taxAmount)) > 0 && (
                    <div className="row">
                      <span>IVA {s.taxRate ?? 21}%</span>
                      <span>{parseFloat(String(s.taxAmount)).toFixed(2)}€</span>
                    </div>
                  )}
                  {(s.fiscalSummary === "reav_only" || s.fiscalSummary === "mixed") && s.reavMargin && parseFloat(String(s.reavMargin)) > 0 && (
                    <div className="row">
                      <span>Margen REAV (Rég. Especial Ag.)</span>
                      <span>{parseFloat(String(s.reavMargin)).toFixed(2)}€</span>
                    </div>
                  )}
                </div>
              </>
            )}
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {salePayments.map((p: any, i: number) => (
              <div key={i} className="row">
                <span>{METHOD_LABELS[p.method] ?? p.method}{p.payerName ? ` (${p.payerName})` : ""}</span>
                <span>{parseFloat(String(p.amount)).toFixed(2)}€</span>
              </div>
            ))}
            <div style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="center" style={{ marginTop: "4px" }}>¡Gracias por su visita!</div>
            <div className="center">www.nayadeexperiences.com</div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              className="bg-gray-700 hover:bg-gray-600 text-white gap-2"
              onClick={handlePrint}
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </Button>
            <Button
              className="bg-blue-700 hover:bg-blue-600 text-white gap-2"
              onClick={() => setShowEmailInput(!showEmailInput)}
            >
              <Mail className="w-4 h-4" />
              Email
            </Button>
          </div>

          {showEmailInput && (
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@cliente.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white text-sm h-9"
              />
              <Button
                size="sm"
                className="bg-blue-700 hover:bg-blue-600 text-white h-9 px-3"
                onClick={handleSendEmail}
                disabled={sendEmailMut.isPending}
              >
                {sendEmailMut.isPending ? "..." : "Enviar"}
              </Button>
            </div>
          )}

          <Button
            className="w-full bg-violet-600 hover:bg-violet-500 text-white font-semibold gap-2"
            onClick={onClose}
          >
            <ShoppingCart className="w-4 h-4" />
            Nueva venta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
