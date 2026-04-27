/**
 * QuoteAcceptance — Página pública de aceptación de presupuesto
 * Ruta: /presupuesto/:token
 *
 * Flujo:
 * 1. Carga el presupuesto por token (getByToken) → marca como "visualizado"
 * 2. Muestra resumen de líneas con precios CONGELADOS
 * 3. Cliente puede ACEPTAR (→ pago Redsys) o RECHAZAR
 * 4. Tras aceptar: formulario Redsys se envía automáticamente
 */
import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePublicPhone } from "@/hooks/usePublicPhone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  CreditCard,
  FileText,
  Phone,
  Mail,
  ShieldCheck,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
  if (isExpired) return <Badge className="bg-red-100 text-red-700 border-red-200">Expirado</Badge>;
  const map: Record<string, { label: string; cls: string }> = {
    borrador:            { label: "Borrador",          cls: "bg-gray-100 text-gray-600 border-gray-200" },
    enviado:             { label: "Pendiente",         cls: "bg-amber-100 text-amber-700 border-amber-200" },
    visualizado:         { label: "Visto",             cls: "bg-blue-100 text-blue-700 border-blue-200" },
    convertido_carrito:  { label: "Pago iniciado",     cls: "bg-purple-100 text-purple-700 border-purple-200" },
    pago_fallido:        { label: "Pago no completado", cls: "bg-orange-100 text-orange-700 border-orange-200" },
    aceptado:            { label: "Aceptado y pagado", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
    rechazado:           { label: "Rechazado",         cls: "bg-red-100 text-red-700 border-red-200" },
    perdido:             { label: "Expirado",          cls: "bg-red-100 text-red-700 border-red-200" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };
  return <Badge className={`${s.cls} border text-xs font-medium`}>{s.label}</Badge>;
}

// ─── Redsys auto-submit form ─────────────────────────────────────────────────

function RedsysAutoForm({ html }: { html: string }) {
  // The HTML from buildRedsysForm contains a <form> with hidden inputs + auto-submit script
  return (
    <div
      className="hidden"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function QuoteAcceptance() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();

  const { phone, phoneTel } = usePublicPhone();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejected, setRejected] = useState(false);
  const [redsysForm, setRedsysForm] = useState<{ url: string; Ds_MerchantParameters: string; Ds_Signature: string; Ds_SignatureVersion: string } | null>(null);
  const [showConditions, setShowConditions] = useState(false);

  // ── Redsys auto-submit effect ──
  // useEffect ensures the form is submitted after render, not during it.
  // The empty-dependency array on redsysForm means it only fires when redsysForm changes.
  useEffect(() => {
    if (!redsysForm) return;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = redsysForm.url;
    const fields: [string, string][] = [
      ["Ds_MerchantParameters", redsysForm.Ds_MerchantParameters],
      ["Ds_Signature", redsysForm.Ds_Signature],
      ["Ds_SignatureVersion", redsysForm.Ds_SignatureVersion],
    ];
    fields.forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }, [redsysForm]);

  // ── Load quote ──
  const { data: quote, isLoading, error } = trpc.crm.quotes.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  // ── Mutations ──
  const rejectMutation = trpc.crm.quotes.rejectByToken.useMutation({
    onSuccess: () => {
      setRejected(true);
      toast.success("Has rechazado el presupuesto. Nos pondremos en contacto contigo.");
    },
    onError: (e) => toast.error(e.message),
  });

  const payMutation = trpc.crm.quotes.payWithToken.useMutation({
    onSuccess: (data) => {
      // Store Redsys form data — the render effect will auto-submit
      setRedsysForm(data.redsysForm as { url: string; Ds_MerchantParameters: string; Ds_Signature: string; Ds_SignatureVersion: string });
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] to-[#1a3a6b] flex items-center justify-center">
        <div className="text-center text-white">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-orange-400" />
          <p className="text-white/70">Cargando tu presupuesto...</p>
        </div>
      </div>
    );
  }

  // ── Error / not found ──
  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] to-[#1a3a6b] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-14 h-14 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Enlace no válido</h1>
          <p className="text-gray-500 text-sm">
            Este enlace de presupuesto no existe o ha sido desactivado. Si crees que es un error,
            contacta con nosotros.
          </p>
          <div className="mt-6 flex flex-col gap-2 text-sm text-gray-500">
            <a href="tel:+34900000000" className="flex items-center justify-center gap-2 hover:text-orange-500">
              <Phone className="w-4 h-4" /> Llamar a Náyade Experiences
            </a>
            <a href="mailto:info@nayadeexperiences.com" className="flex items-center justify-center gap-2 hover:text-orange-500">
              <Mail className="w-4 h-4" /> info@nayadeexperiences.com
            </a>
          </div>
        </div>
      </div>
    );
  }

  const items = quote.items ?? [];
  const canAct = !quote.isPaid && !quote.isExpired && !quote.isRejected && !rejected;

  const installmentPlan = quote.installmentPlan ?? null;
  const firstRequiredCents = installmentPlan?.firstRequiredAmountCents ?? null;
  const payAmountCents = firstRequiredCents ?? Math.round(Number(quote.total) * 100);
  const payAmountEuros = payAmountCents / 100;

  function formatInstallmentStatus(s: string) {
    const map: Record<string, string> = { pending: "Pendiente", paid: "Pagada", overdue: "Vencida", cancelled: "Cancelada" };
    return map[s] ?? s;
  }

  // ── Already paid ──
  if (quote.isPaid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#1a3a6b]">
        {/* Header */}
        <header className="bg-white/5 backdrop-blur-sm border-b border-white/10">
          <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-orange-400 bg-white/10 flex items-center justify-center">
                <span className="text-orange-400 font-bold text-sm">N</span>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Náyade Experiences</p>
                <p className="text-white/50 text-xs">Skicenter — Reserva confirmada</p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 border text-xs font-medium">
              Aceptado y pagado
            </Badge>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          {/* Confirmed banner */}
          <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-2xl px-6 py-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-white text-xl font-bold">¡Reserva confirmada!</h1>
              <p className="text-white/60 text-sm mt-0.5">
                Tu pago ha sido procesado correctamente. Recibirás la factura en tu email.
              </p>
            </div>
          </div>

          {/* Quote detail card — same layout as pending state */}
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-[#1a3a6b] to-[#0d2a5e] px-6 py-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-orange-400 text-xs font-semibold uppercase tracking-wider mb-1">
                    Presupuesto {quote.quoteNumber}
                  </p>
                  <h2 className="text-white text-xl font-bold leading-tight">{quote.title}</h2>
                </div>
                <FileText className="w-8 h-8 text-white/30 flex-shrink-0 mt-1" />
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-gray-400 text-xs uppercase tracking-wide">Cliente</span>
                  <p className="font-medium text-gray-800">{quote.clientName}</p>
                </div>
                {quote.invoiceNumber && (
                  <div>
                    <span className="text-gray-400 text-xs uppercase tracking-wide">Factura</span>
                    <p className="font-medium text-gray-800">{quote.invoiceNumber}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="px-6 py-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Concepto</th>
                    <th className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-16">Uds.</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-24">P. Unit.</th>
                    <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-24">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 text-gray-800 font-medium">{item.description}</td>
                      <td className="py-3 text-center text-gray-500">{item.quantity}</td>
                      <td className="py-3 text-right text-gray-600">{formatCurrency(item.unitPrice)}</td>
                      <td className="py-3 text-right font-semibold text-gray-800">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
              <div className="flex flex-col items-end gap-1 text-sm">
                {Number(quote.subtotal) > 0 && (
                  <div className="flex justify-between w-48">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="text-gray-700">{formatCurrency(quote.subtotal)}</span>
                  </div>
                )}
                {Number(quote.discount) > 0 && (
                  <div className="flex justify-between w-48">
                    <span className="text-gray-500">Descuento</span>
                    <span className="text-emerald-600">−{formatCurrency(quote.discount)}</span>
                  </div>
                )}
                {Number(quote.tax) > 0 && (
                  <div className="flex justify-between w-48">
                    <span className="text-gray-500">IVA</span>
                    <span className="text-gray-700">{formatCurrency(quote.tax)}</span>
                  </div>
                )}
                <Separator className="w-48 my-1" />
                <div className="flex justify-between w-48">
                  <span className="font-bold text-gray-900 text-base">Total pagado</span>
                  <span className="font-bold text-emerald-600 text-xl">{formatCurrency(quote.total)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Plan de pagos (si aplica) */}
          {installmentPlan && installmentPlan.installments.length > 0 && (
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="bg-gradient-to-r from-purple-700 to-purple-900 px-6 py-4">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-purple-200" />
                  <h2 className="text-white font-bold text-base">Plan de pago fraccionado</h2>
                </div>
              </div>
              <div className="divide-y divide-gray-100">
                {installmentPlan.installments.map((inst) => {
                  const isPaid = inst.status === "paid";
                  return (
                    <div key={inst.id} className={`px-6 py-4 flex items-center justify-between ${isPaid ? "bg-emerald-50" : ""}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isPaid ? "bg-emerald-500 text-white" : "bg-purple-100 text-purple-700"}`}>
                          {isPaid ? "✓" : inst.installmentNumber}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-800">Cuota {inst.installmentNumber}</p>
                          <p className="text-xs text-gray-400 flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" /> Vence: {formatDate(inst.dueDate)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold text-base ${isPaid ? "text-emerald-600" : "text-gray-900"}`}>
                          {formatCurrency(inst.amountCents / 100)}
                        </p>
                        <p className={`text-xs ${isPaid ? "text-emerald-500" : "text-gray-400"}`}>
                          {formatInstallmentStatus(inst.status)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          {quote.invoicePdfUrl && (
            <div className="bg-white rounded-2xl shadow-xl p-6 text-center">
              <a
                href={quote.invoicePdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl text-sm font-semibold transition-colors shadow-lg shadow-orange-500/20"
              >
                <Download className="w-4 h-4" /> Descargar factura
              </a>
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-white/40 text-xs pb-8 space-y-1">
            <p>¿Tienes dudas? Contacta con nosotros</p>
            <div className="flex justify-center gap-4">
              <a href={phoneTel} className="hover:text-orange-400 flex items-center gap-1">
                <Phone className="w-3 h-3" /> {phone}
              </a>
              <a href="mailto:reservas@nayadeexperiences.es" className="hover:text-orange-400 flex items-center gap-1">
                <Mail className="w-3 h-3" /> reservas@nayadeexperiences.es
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Rejected ──
  if (quote.isRejected || rejected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] to-[#1a3a6b] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Presupuesto rechazado</h1>
          <p className="text-gray-500 text-sm">
            Has rechazado este presupuesto. Si cambias de opinión o quieres hablar con nosotros,
            no dudes en contactarnos.
          </p>
          <div className="mt-6 flex flex-col gap-2 text-sm text-gray-500">
            <a href="tel:+34900000000" className="flex items-center justify-center gap-2 hover:text-orange-500">
              <Phone className="w-4 h-4" /> Llamar a Náyade Experiences
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Expired ──
  if (quote.isExpired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0a1628] to-[#1a3a6b] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
          <Clock className="w-16 h-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Presupuesto expirado</h1>
          <p className="text-gray-500 text-sm">
            Este presupuesto expiró el {formatDate(quote.validUntil)}. Contacta con nosotros para
            solicitar uno nuevo.
          </p>
          <div className="mt-6 flex flex-col gap-2 text-sm text-gray-500">
            <a href="tel:+34900000000" className="flex items-center justify-center gap-2 hover:text-orange-500">
              <Phone className="w-4 h-4" /> Llamar a Náyade Experiences
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#1a3a6b]">
      {/* Redsys auto-submit is handled via useEffect above */}

      {/* Header */}
      <header className="bg-white/5 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-orange-400 bg-white/10 flex items-center justify-center">
              <span className="text-orange-400 font-bold text-sm">N</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">Náyade Experiences</p>
              <p className="text-white/50 text-xs">Skicenter — Presupuesto personalizado</p>
            </div>
          </div>
          <StatusBadge status={quote.status} isExpired={quote.isExpired} />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Aviso de pago fallido */}
        {quote.status === "pago_fallido" && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-4 flex gap-3 items-start">
            <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-orange-800 font-semibold text-sm">El pago anterior no se completó</p>
              <p className="text-orange-600 text-xs mt-0.5">
                Puedes intentarlo de nuevo con otra tarjeta o método de pago. El presupuesto sigue siendo válido.
              </p>
            </div>
          </div>
        )}

        {/* Title card */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-gradient-to-r from-[#1a3a6b] to-[#0d2a5e] px-6 py-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-orange-400 text-xs font-semibold uppercase tracking-wider mb-1">
                  Presupuesto {quote.quoteNumber}
                </p>
                <h1 className="text-white text-xl font-bold leading-tight">{quote.title}</h1>
              </div>
              <FileText className="w-8 h-8 text-white/30 flex-shrink-0 mt-1" />
            </div>
          </div>

          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-gray-400 text-xs uppercase tracking-wide">Para</span>
                <p className="font-medium text-gray-800">{quote.clientName}</p>
              </div>
              {quote.validUntil && (
                <div>
                  <span className="text-gray-400 text-xs uppercase tracking-wide">Válido hasta</span>
                  <p className="font-medium text-gray-800">{formatDate(quote.validUntil)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Items */}
          <div className="px-6 py-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2">Concepto</th>
                  <th className="text-center text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-16">Uds.</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-24">P. Unit.</th>
                  <th className="text-right text-xs font-semibold text-gray-400 uppercase tracking-wide pb-2 w-24">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 text-gray-800 font-medium">{item.description}</td>
                    <td className="py-3 text-center text-gray-500">{item.quantity}</td>
                    <td className="py-3 text-right text-gray-600">{formatCurrency(item.unitPrice)}</td>
                    <td className="py-3 text-right font-semibold text-gray-800">{formatCurrency(item.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <div className="flex flex-col items-end gap-1 text-sm">
              <div className="flex justify-between w-48">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-700">{formatCurrency(quote.subtotal)}</span>
              </div>
              {Number(quote.discount) > 0 && (
                <div className="flex justify-between w-48">
                  <span className="text-gray-500">Descuento</span>
                  <span className="text-emerald-600">−{formatCurrency(quote.discount)}</span>
                </div>
              )}
              {Number(quote.tax) > 0 && (
                <div className="flex justify-between w-48">
                  <span className="text-gray-500">IVA</span>
                  <span className="text-gray-700">{formatCurrency(quote.tax)}</span>
                </div>
              )}
              <Separator className="w-48 my-1" />
              <div className="flex justify-between w-48">
                <span className="font-bold text-gray-900 text-base">Total</span>
                <span className="font-bold text-orange-500 text-xl">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Plan de pagos fraccionado */}
        {installmentPlan && installmentPlan.installments.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-purple-700 to-purple-900 px-6 py-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-purple-200" />
                <h2 className="text-white font-bold text-base">Plan de pago fraccionado</h2>
              </div>
              <p className="text-purple-200 text-xs mt-1">
                Este presupuesto se abona en {installmentPlan.installments.length} cuota{installmentPlan.installments.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="divide-y divide-gray-100">
              {installmentPlan.installments.map((inst) => {
                const isPaid = inst.status === "paid";
                const isOverdue = inst.status === "overdue";
                const isRequired = inst.isRequiredForConfirmation;
                return (
                  <div key={inst.id} className={`px-6 py-4 flex items-center justify-between ${isPaid ? "bg-emerald-50" : isOverdue ? "bg-red-50" : ""}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isPaid ? "bg-emerald-500 text-white" : isOverdue ? "bg-red-500 text-white" : "bg-purple-100 text-purple-700"}`}>
                        {isPaid ? "✓" : inst.installmentNumber}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-800">
                          Cuota {inst.installmentNumber}
                          {isRequired && <span className="ml-2 text-xs text-purple-600 font-semibold bg-purple-50 px-2 py-0.5 rounded-full">Cuota inaplazable</span>}
                        </p>
                        <p className="text-xs text-gray-400 flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" /> Vence: {formatDate(inst.dueDate)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold text-base ${isPaid ? "text-emerald-600" : isOverdue ? "text-red-600" : "text-gray-900"}`}>
                        {formatCurrency(inst.amountCents / 100)}
                      </p>
                      <p className={`text-xs ${isPaid ? "text-emerald-500" : isOverdue ? "text-red-500" : "text-gray-400"}`}>
                        {formatInstallmentStatus(inst.status)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes */}
        {quote.notes && (
          <div className="bg-white rounded-xl shadow p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Notas del presupuesto</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{quote.notes}</p>
          </div>
        )}

        {/* Conditions (collapsible) */}
        {quote.conditions && (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              onClick={() => setShowConditions(!showConditions)}
            >
              <span>Condiciones y términos</span>
              {showConditions ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {showConditions && (
              <div className="px-5 pb-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 whitespace-pre-wrap leading-relaxed pt-3">{quote.conditions}</p>
              </div>
            )}
          </div>
        )}

        {/* CTA — Accept / Reject */}
        {canAct && (
          <div className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>Pago seguro procesado por Redsys · SSL cifrado</span>
            </div>

            {/* Accept button */}
            <Button
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold text-base py-6 rounded-xl shadow-lg shadow-orange-500/20 transition-all"
              onClick={() => payMutation.mutate({ token: token!, origin: window.location.origin })}
              disabled={payMutation.isPending}
            >
              {payMutation.isPending ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Preparando pago...</>
              ) : installmentPlan ? (
                <><CreditCard className="w-5 h-5 mr-2" /> Pagar 1ª cuota: {formatCurrency(payAmountEuros)}</>
              ) : (
                <><CreditCard className="w-5 h-5 mr-2" /> Aceptar y pagar {formatCurrency(quote.total)}</>
              )}
            </Button>
            {installmentPlan && (
              <p className="text-center text-xs text-gray-400">
                Importe total del presupuesto: {formatCurrency(quote.total)} · Pago fraccionado en {installmentPlan.installments.length} cuotas
              </p>
            )}

            {/* Reject */}
            {!showRejectForm ? (
              <button
                className="w-full text-sm text-gray-400 hover:text-red-500 transition-colors py-2"
                onClick={() => setShowRejectForm(true)}
              >
                No me interesa — Rechazar presupuesto
              </button>
            ) : (
              <div className="border border-red-200 rounded-xl p-4 bg-red-50 space-y-3">
                <p className="text-sm font-medium text-red-700">¿Seguro que quieres rechazar este presupuesto?</p>
                <Textarea
                  placeholder="Motivo del rechazo (opcional)..."
                  className="text-sm resize-none"
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setShowRejectForm(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                    onClick={() => rejectMutation.mutate({ token: token!, reason: rejectReason || undefined })}
                    disabled={rejectMutation.isPending}
                  >
                    {rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar rechazo"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-white/40 text-xs pb-8 space-y-1">
          <p>¿Tienes dudas? Contacta con nosotros</p>
          <div className="flex justify-center gap-4">
            <a href="tel:+34900000000" className="hover:text-orange-400 flex items-center gap-1">
              <Phone className="w-3 h-3" /> Teléfono
            </a>
            <a href="mailto:info@nayadeexperiences.com" className="hover:text-orange-400 flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}


