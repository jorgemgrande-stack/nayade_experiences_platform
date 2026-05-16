/**
 * ReservationTicket — Ticket térmico 80mm para cualquier reserva del CRM.
 *
 * Mismo formato y lógica de impresión que TpvTicket pero adaptado al shape
 * de una reserva (no de una venta TPV). Permite imprimir desde la tabla
 * de reservas en cualquier momento, no solo al confirmar el pago.
 */
import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";

interface ReservationData {
  reservationNumber?: string | null;
  merchantOrder?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  productName?: string | null;
  people?: number | null;
  amountTotal?: number | null;       // en céntimos
  amountPaid?: number | null;        // en céntimos
  paymentMethod?: string | null;
  bookingDate?: string | null;
  selectedTime?: string | null;
  channel?: string | null;
  invoiceNumber?: string | null;
  createdAt?: number | string | Date | null;
}

interface Props {
  open: boolean;
  reservation: ReservationData | null;
  onClose: () => void;
}

const METHOD_LABELS: Record<string, string> = {
  efectivo:        "Efectivo",
  transferencia:   "Transferencia",
  tarjeta_fisica:  "Tarjeta",
  tarjeta_redsys:  "Tarjeta (Redsys)",
  redsys:          "Tarjeta (Redsys)",
  link_pago:       "Link de pago",
  otro:            "Otro",
};

const CHANNEL_LABELS: Record<string, string> = {
  ONLINE_DIRECTO:  "Online",
  TPV_FISICO:      "TPV",
  PARTNER:         "Partner",
  CRM:             "CRM",
  TICKETING:       "Cupón",
  crm:             "CRM",
  telefono:        "Teléfono",
  email:           "Email",
  web:             "Web",
  groupon:         "Groupon",
};

const fmt = (cents: number | null | undefined): string => {
  const n = (cents ?? 0) / 100;
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
};

function printThermalTicket80mm(innerHtml: string, ticketNumber: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Reserva ${ticketNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      font-family: 'Courier New', 'Consolas', 'Lucida Console', monospace;
      font-size: 13px; line-height: 1.35; color: #000; background: #fff;
      margin: 0; padding: 0;
    }
    body { width: 60mm; margin: 0; padding: 0; }
    .center { text-align: center; }
    .bold   { font-weight: 700; }
    .line   { border-top: 1px dashed #000; margin: 4px 0; }
    .row    { display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
    .row > span:first-child { word-break: break-word; min-width: 0; }
    .row > span:last-child  { white-space: nowrap; }
    .total  { font-size: 17px; font-weight: 700; padding: 4px 0; }
    .small  { font-size: 11px; color: #000; }
    .item-name { font-weight: 700; word-break: break-word; }
    .text-sm { font-size: 14px; }
    .text-xs { font-size: 12px; }
    img { display: block; margin: 0 auto; max-width: 44mm; height: auto; }
    .feed { height: 16mm; }
  </style>
</head>
<body>
${innerHtml}
<div class="feed"></div>
</body>
</html>`);
  doc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error("[ReservationTicket] print error:", err);
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 2000);
    }
  };

  const imgs = doc.images;
  if (imgs && imgs.length > 0) {
    let pending = imgs.length;
    const done = () => { if (--pending <= 0) triggerPrint(); };
    Array.from(imgs).forEach(img => {
      if (img.complete) done();
      else { img.addEventListener("load", done); img.addEventListener("error", done); }
    });
    setTimeout(triggerPrint, 1500);
  } else {
    setTimeout(triggerPrint, 100);
  }
}

export default function ReservationTicket({ open, reservation, onClose }: Props) {
  const ticketRef = useRef<HTMLDivElement>(null);

  if (!reservation) return null;

  const r = reservation;
  const ticketNumber = r.reservationNumber ?? r.merchantOrder ?? "—";
  const createdAt = r.createdAt ? new Date(r.createdAt) : new Date();
  const dateStr = createdAt.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = createdAt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const people = r.people ?? 1;
  const unitPriceCents = people > 0 ? Math.round((r.amountTotal ?? 0) / people) : (r.amountTotal ?? 0);
  const paymentLabel = r.paymentMethod ? (METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod) : null;
  const channelLabel = r.channel ? (CHANNEL_LABELS[r.channel] ?? r.channel) : null;

  const handlePrint = () => {
    const html = ticketRef.current?.innerHTML;
    if (!html) return;
    printThermalTicket80mm(html, ticketNumber);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-700 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-white" style={{ color: "white" }}>
            <span className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-orange-400" />
              Imprimir ticket reserva
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Preview del ticket */}
        <div
          className="rounded-lg p-4 font-mono overflow-auto max-h-80"
          style={{ backgroundColor: "#ffffff", color: "#000000", fontSize: "13px", lineHeight: 1.35 }}
        >
          <div ref={ticketRef}>
            <div className="center" style={{ marginBottom: "6px" }}>
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_logo_ticket_30350573.png"
                alt="Náyade"
                style={{ width: "60px", height: "60px", objectFit: "contain", display: "inline-block" }}
              />
            </div>
            <div className="center bold text-sm" style={{ fontSize: "14px" }}>NÁYADE EXPERIENCES</div>
            <div className="center text-xs" style={{ fontSize: "12px" }}>Los Ángeles de San Rafael · Segovia</div>
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="center small" style={{ fontSize: "11px" }}>Iron Elephant Consulting S.L. · CIF: B26987875</div>
            <div className="center small" style={{ fontSize: "11px" }}>C/ Corazón de María 57, 1º D · 28002 Madrid</div>
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{dateStr} {timeStr}</span>
              <span className="bold" style={{ fontWeight: 700 }}>{ticketNumber}</span>
            </div>
            {r.customerName && <div style={{ marginTop: "2px" }}>Cliente: {r.customerName}</div>}
            {channelLabel && <div className="small" style={{ fontSize: "11px" }}>Canal: {channelLabel}</div>}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {r.bookingDate && (
              <div style={{ marginBottom: "2px" }}>
                Fecha actividad: <span className="bold" style={{ fontWeight: 700 }}>{r.bookingDate}</span>
                {r.selectedTime ? ` · ${r.selectedTime}` : ""}
              </div>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div style={{ marginBottom: "3px" }}>
              <div className="item-name bold" style={{ fontWeight: 700, wordBreak: "break-word" }}>
                {r.productName ?? "Reserva"}
              </div>
              <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{people} x {fmt(unitPriceCents)}€</span>
                <span>{fmt(r.amountTotal)}€</span>
              </div>
            </div>
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal</span>
              <span>{fmt(r.amountTotal)}€</span>
            </div>
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row total" style={{ display: "flex", justifyContent: "space-between", fontSize: "17px", fontWeight: 700, padding: "4px 0" }}>
              <span>TOTAL</span>
              <span>{fmt(r.amountTotal)}€</span>
            </div>
            {(r.amountPaid ?? 0) > 0 && (r.amountPaid ?? 0) !== (r.amountTotal ?? 0) && (
              <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Pagado</span>
                <span>{fmt(r.amountPaid)}€</span>
              </div>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {paymentLabel && (
              <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{paymentLabel}</span>
                <span>{fmt(r.amountPaid ?? r.amountTotal)}€</span>
              </div>
            )}
            {r.invoiceNumber && (
              <div className="small" style={{ fontSize: "11px", marginTop: "2px" }}>
                Factura: {r.invoiceNumber}
              </div>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="center" style={{ marginTop: "4px" }}>¡Gracias por su visita!</div>
            <div className="center">www.nayadeexperiences.com</div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <Button
            className="w-full bg-orange-600 hover:bg-orange-500 text-white gap-2"
            onClick={handlePrint}
          >
            <Printer className="w-4 h-4" />
            Imprimir ticket
          </Button>
          <Button
            variant="outline"
            className="w-full text-white border-gray-600 hover:bg-gray-800 gap-2"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
