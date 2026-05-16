/**
 * TpvTicket — Ticket térmico optimizado para Epson TM-T20II 80mm
 *
 * Notas técnicas (impresora Epson TM-T20II):
 * - Ancho físico: 80 mm. Ancho imprimible: ~72 mm (3 mm de padding cada lado).
 * - El corte automático depende del driver Windows ("Auto cut at document end").
 *   Si el driver está bien configurado, basta con que el navegador termine
 *   la página de impresión: por eso añadimos un "feed" final controlado.
 * - Imprimir desde el navegador NO permite enviar comandos ESC/POS directos.
 *   Si se necesita corte forzado vía software, hay que usar el driver "Generic /
 *   Text Only" o un puente WebUSB — fuera del alcance de esta vista.
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Printer, Mail, ShoppingCart } from "lucide-react";

interface SaleItem {
  productName: string;
  quantity: number;
  unitPrice: string | number;
  discountPercent: string | number;
  // El backend guarda el total de línea en `subtotal`. Mantenemos `lineTotal`
  // como fallback opcional por compatibilidad histórica.
  subtotal?: string | number;
  lineTotal?: string | number;
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

// Formateador seguro: nunca devuelve NaN
const fmt = (v: unknown): string => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
};

// Total de línea robusto: usa `subtotal`, si no `lineTotal`, si no calcula
const lineTotalOf = (item: SaleItem): number => {
  const candidate = item.subtotal ?? item.lineTotal;
  const n = parseFloat(String(candidate ?? "NaN"));
  if (Number.isFinite(n)) return n;
  const qty = parseFloat(String(item.quantity ?? 0));
  const price = parseFloat(String(item.unitPrice ?? 0));
  const disc = parseFloat(String(item.discountPercent ?? 0));
  return qty * price * (1 - (disc || 0) / 100);
};

/**
 * printThermalTicket80mm — Imprime el HTML del ticket en una página
 * configurada específicamente para impresoras térmicas de 80 mm.
 *
 * Usamos un iframe oculto (en lugar de window.open) porque:
 *  - Algunos bloqueadores de pop-ups bloquean window.open.
 *  - El iframe permite controlar el momento del print() tras carga completa.
 *  - Evita el flash visual de una ventana nueva.
 *
 * El @page con size:80mm auto fuerza al driver a tratar la salida como un
 * único ticket continuo. La franja `feed` final empuja papel suficiente para
 * que la cuchilla del auto-cut quede más allá del último carácter impreso.
 */
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
  <title>Ticket ${ticketNumber}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body {
      font-family: 'Courier New', 'Consolas', 'Lucida Console', monospace;
      font-size: 13px;
      line-height: 1.35;
      color: #000;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    body {
      /* La TM-T20II + driver Windows tiene una zona izquierda no imprimible
         más amplia de lo habitual (~12-14mm). Empujamos el contenido a la
         derecha con margin-left para que toda la columna quede dentro de la
         zona imprimible real. Resultado: contenido de 58mm en el rango
         [14mm, 72mm] de los 80mm del papel. */
      width: 58mm;
      margin: 0 0 0 14mm;
      padding: 0;
    }
    .center { text-align: center; }
    .bold   { font-weight: 700; }
    .line   { border-top: 1px dashed #000; margin: 4px 0; }
    .row    {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      align-items: baseline;
    }
    .row > span:first-child  { word-break: break-word; min-width: 0; }
    .row > span:last-child   { white-space: nowrap; }
    .total  { font-size: 17px; font-weight: 700; padding: 4px 0; }
    .small  { font-size: 11px; color: #000; }
    .item-name { font-weight: 700; word-break: break-word; }
    .text-sm { font-size: 14px; }
    .text-xs { font-size: 12px; }
    img { display: block; margin: 0 auto; max-width: 44mm; height: auto; }
    /* Avance de papel final: empuja el último carácter por encima de la cuchilla
       y deja margen para corte limpio. ~16 mm suele bastar en TM-T20II. */
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
      console.error("[TpvTicket] print error:", err);
    } finally {
      // Damos margen al diálogo de impresión y a la cola del driver antes
      // de retirar el iframe (Chrome necesita el iframe vivo hasta que el
      // print job se ha enviado realmente).
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 2000);
    }
  };

  // Esperar a que las imágenes (logo) carguen antes de imprimir.
  const imgs = doc.images;
  if (imgs && imgs.length > 0) {
    let pending = imgs.length;
    const done = () => { if (--pending <= 0) triggerPrint(); };
    Array.from(imgs).forEach(img => {
      if (img.complete) done();
      else { img.addEventListener("load", done); img.addEventListener("error", done); }
    });
    // Failsafe por si una imagen no dispara load (CORS, etc.)
    setTimeout(triggerPrint, 1500);
  } else {
    setTimeout(triggerPrint, 100);
  }
}

export default function TpvTicket({ open, sale, onClose }: Props) {
  const [emailInput, setEmailInput] = useState(sale.sale.customerEmail ?? "");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const ticketRef = useRef<HTMLDivElement>(null);

  const sendEmailMut = trpc.tpv.sendTicketEmail.useMutation({
    onSuccess: () => toast.success("Ticket enviado por email"),
    onError: (err) => toast.error(err.message),
  });

  const s = sale.sale;
  const saleItems: SaleItem[] = ((s as any).items ?? []) as SaleItem[];
  const salePayments: SalePayment[] = ((s as any).payments ?? []) as SalePayment[];
  const date = new Date(s.createdAt);
  const dateStr = date.toLocaleDateString("es-ES", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const timeStr = date.toLocaleTimeString("es-ES", {
    hour: "2-digit", minute: "2-digit",
  });

  const handlePrint = () => {
    const html = ticketRef.current?.innerHTML;
    if (!html) return;
    printThermalTicket80mm(html, s.ticketNumber);
  };

  // Ticket de prueba para validar ancho, fuente y corte sin generar venta
  const handleTestPrint = () => {
    const testHtml = `
      <div class="center bold text-sm">NÁYADE EXPERIENCES</div>
      <div class="center text-xs">TEST DE IMPRESIÓN 80mm</div>
      <div class="line"></div>
      <div class="row"><span>${new Date().toLocaleString("es-ES")}</span><span class="bold">TEST</span></div>
      <div class="line"></div>
      <div class="item-name">Producto de prueba con nombre largo para validar el salto de linea</div>
      <div class="row"><span>1 x 12.34€</span><span>12.34€</span></div>
      <div class="item-name">Otro concepto</div>
      <div class="row"><span>2 x 5.00€</span><span>10.00€</span></div>
      <div class="line"></div>
      <div class="row"><span>Subtotal</span><span>22.34€</span></div>
      <div class="line"></div>
      <div class="row total"><span>TOTAL</span><span>22.34€</span></div>
      <div class="line"></div>
      <div class="row"><span>Tarjeta</span><span>22.34€</span></div>
      <div class="line"></div>
      <div class="center" style="margin-top:4px;">— Prueba OK —</div>
      <div class="center small">Si lees esto centrado y completo, el ancho es correcto</div>
    `;
    printThermalTicket80mm(testHtml, "TEST");
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
      <DialogContent className="bg-gray-900 border-gray-700 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between text-white" style={{ color: "white" }}>
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-green-400" />
              Venta completada
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Ticket preview (mismo HTML que va a imprimirse: usa clases que
            la hoja de impresión reconoce) */}
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
              <span className="bold" style={{ fontWeight: 700 }}>{s.ticketNumber}</span>
            </div>
            {s.customerName && (
              <div style={{ marginTop: "2px" }}>Cliente: {s.customerName}</div>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {saleItems.map((item, i) => {
              const lineTotal = lineTotalOf(item);
              const disc = parseFloat(String(item.discountPercent ?? 0));
              return (
                <div key={i} style={{ marginBottom: "3px" }}>
                  <div className="item-name bold" style={{ fontWeight: 700, wordBreak: "break-word" }}>
                    {item.productName}
                  </div>
                  <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{item.quantity} x {fmt(item.unitPrice)}€</span>
                    <span>{fmt(lineTotal)}€</span>
                  </div>
                  {disc > 0 && (
                    <div className="small" style={{ fontSize: "11px" }}>
                      Dto. {disc.toFixed(0)}%
                    </div>
                  )}
                </div>
              );
            })}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal</span>
              <span>{fmt(s.subtotal)}€</span>
            </div>
            {parseFloat(String(s.discountAmount ?? 0)) > 0 && (
              <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Descuento</span>
                <span>-{fmt(s.discountAmount)}€</span>
              </div>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            <div className="row total" style={{ display: "flex", justifyContent: "space-between", fontSize: "17px", fontWeight: 700, padding: "4px 0" }}>
              <span>TOTAL</span>
              <span>{fmt(s.total)}€</span>
            </div>
            {/* Desglose fiscal */}
            {(s.taxBase || s.reavMargin) && (
              <>
                <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
                <div className="small" style={{ fontSize: "11px" }}>
                  {s.fiscalSummary !== "reav_only" && s.taxBase && parseFloat(String(s.taxBase)) > 0 && (
                    <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Base IVA {s.taxRate ?? 21}%</span>
                      <span>{fmt(s.taxBase)}€</span>
                    </div>
                  )}
                  {s.fiscalSummary !== "reav_only" && s.taxAmount && parseFloat(String(s.taxAmount)) > 0 && (
                    <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>IVA {s.taxRate ?? 21}%</span>
                      <span>{fmt(s.taxAmount)}€</span>
                    </div>
                  )}
                  {(s.fiscalSummary === "reav_only" || s.fiscalSummary === "mixed") && s.reavMargin && parseFloat(String(s.reavMargin)) > 0 && (
                    <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Margen REAV (Rég. Especial Ag.)</span>
                      <span>{fmt(s.reavMargin)}€</span>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
            {salePayments.map((p, i) => (
              <div key={i} className="row" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{METHOD_LABELS[p.method] ?? p.method}{p.payerName ? ` (${p.payerName})` : ""}</span>
                <span>{fmt(p.amount)}€</span>
              </div>
            ))}
            <div className="line" style={{ borderTop: "1px dashed #000", margin: "4px 0" }} />
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

          {/* Test print (solo visible si quieres validar la impresora) */}
          <button
            type="button"
            onClick={handleTestPrint}
            className="w-full text-xs text-gray-400 hover:text-gray-200 underline underline-offset-2 pt-1"
          >
            Imprimir ticket de prueba (80mm)
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
