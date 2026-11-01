/**
 * QuoteAcceptance — Página pública de aceptación de presupuesto
 * Ruta: /presupuesto/:token
 *
 * Flujo:
 * 1. Carga el presupuesto por token (getByToken) y lo marca como «visualizado»
 * 2. Muestra el resumen de líneas con precios CONGELADOS
 * 3. El cliente puede ACEPTAR (pago con tarjeta en la pasarela de la empresa) o RECHAZAR
 * 4. Tras aceptar, el formulario de la pasarela se envía automáticamente
 *
 * Imagen: la de la empresa que envía el presupuesto (logotipo, nombre y colores de `public.getTheme`, que
 * TenantThemeLoader aplica como variables del tema); sin logotipo, un marcador neutro. Colores por significado de
 * `@/lib/panelTones` (contraste AA en claro y oscuro).
 */
import { useState, useEffect, type ReactNode } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { TONE_BADGE, TONE_SURFACE } from "@/lib/panelTones";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  CreditCard,
  Download,
  FileText,
  Loader2,
  Mail,
  Phone,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { quoteStatusView } from "@shared/quotePublicView";

// --- Helpers ----------------------------------------------------------------

function formatCurrency(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

// --- Marca de la empresa -------------------------------------------------------

/** Logotipo de la empresa o, si no tiene, un marcador neutro (nunca la inicial ni los colores de otra empresa). */
function BrandMark({ logoUrl, brandName }: { logoUrl: string | null; brandName: string }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={brandName || "Logotipo"} className="h-10 w-auto max-w-[160px] object-contain" />;
  }
  return (
    <div className="w-10 h-10 rounded-full border border-border bg-muted flex items-center justify-center shrink-0" aria-hidden="true" data-testid="marca-neutra">
      <Building2 className="w-5 h-5 text-muted-foreground" />
    </div>
  );
}

function BrandHeader({ logoUrl, brandName, subtitle, right }: { logoUrl: string | null; brandName: string; subtitle: string; right?: ReactNode }) {
  return (
    <header className="bg-background border-b border-border">
      <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <BrandMark logoUrl={logoUrl} brandName={brandName} />
          <div className="min-w-0">
            {brandName && <p className="text-foreground font-semibold text-sm break-words">{brandName}</p>}
            <p className="text-muted-foreground text-xs">{subtitle}</p>
          </div>
        </div>
        {right}
      </div>
    </header>
  );
}

function StatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
  const s = quoteStatusView(status, isExpired);
  return <Badge variant="outline" className={`${TONE_BADGE[s.tone]} border text-xs font-medium shrink-0`}>{s.label}</Badge>;
}

/** Tarjeta centrada para los estados sin presupuesto que mostrar (enlace no válido, rechazado, expirado). */
function NoticeCard({ icon, title, children, contact }: { icon: ReactNode; title: string; children: ReactNode; contact: ReactNode }) {
  return (
    <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
      {icon}
      <h1 className="text-xl font-bold text-foreground mb-2">{title}</h1>
      <p className="text-muted-foreground text-sm">{children}</p>
      <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground">{contact}</div>
    </div>
  );
}

// --- Main Component ----------------------------------------------------------

export default function QuoteAcceptance() {
  const { token } = useParams<{ token: string }>();

  const { phone, phoneTel, email, brandName, logoUrl, neutral } = usePublicContact();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejected, setRejected] = useState(false);
  const [redsysForm, setRedsysForm] = useState<{ url: string; Ds_MerchantParameters: string; Ds_Signature: string; Ds_SignatureVersion: string } | null>(null);
  const [showConditions, setShowConditions] = useState(false);

  // -- Envío automático del formulario de la pasarela de pago --
  // useEffect: el formulario se envía después del render, no durante él.
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

  // -- Load quote --
  const { data: quote, isLoading, error } = trpc.crm.quotes.getByToken.useQuery(
    { token: token ?? "" },
    { enabled: !!token, retry: false }
  );

  // -- Mutations --
  const rejectMutation = trpc.crm.quotes.rejectByToken.useMutation({
    onSuccess: () => {
      setRejected(true);
      toast.success("Has rechazado el presupuesto. Nos pondremos en contacto contigo.");
    },
    onError: (e) => toast.error(e.message),
  });

  const payMutation = trpc.crm.quotes.payWithToken.useMutation({
    onSuccess: (data) => {
      // Datos del formulario de la pasarela: el efecto de arriba lo envía
      setRedsysForm(data.redsysForm as { url: string; Ds_MerchantParameters: string; Ds_Signature: string; Ds_SignatureVersion: string });
    },
    onError: (e) => toast.error(e.message),
  });

  const callLink = phoneTel ? (
    <a href={phoneTel} className="flex items-center justify-center gap-2 text-foreground underline-offset-2 hover:underline">
      <Phone className="w-4 h-4" /> {brandName ? `Llamar a ${brandName}` : "Llamar"}
    </a>
  ) : null;
  const mailLink = email ? (
    <a href={`mailto:${email}`} className="flex items-center justify-center gap-2 text-foreground underline-offset-2 hover:underline">
      <Mail className="w-4 h-4" /> {email}
    </a>
  ) : null;
  const page = (content: ReactNode) => <div className="min-h-screen bg-muted/40 text-foreground">{content}</div>;
  const centered = (content: ReactNode) => page(<div className="min-h-screen flex items-center justify-center p-4">{content}</div>);

  // -- Loading --
  if (isLoading) {
    return centered(
      <div className="text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-primary" />
        <p className="text-muted-foreground">Cargando tu presupuesto...</p>
      </div>
    );
  }

  // -- Error / not found --
  if (error || !quote) {
    return centered(
      <NoticeCard icon={<AlertTriangle className="w-14 h-14 text-danger mx-auto mb-4" />} title="Enlace no válido" contact={<>{callLink}{mailLink}</>}>
        Este enlace de presupuesto no existe o ha sido desactivado. Si crees que es un error, contacta con nosotros.
      </NoticeCard>
    );
  }

  const items = quote.items ?? [];
  const canAct = !quote.isPaid && !quote.isExpired && !quote.isRejected && !rejected;

  const installmentPlan = quote.installmentPlan ?? null;
  const firstRequiredCents = installmentPlan?.firstRequiredAmountCents ?? null;
  const payAmountCents = firstRequiredCents ?? Math.round(Number(quote.total) * 100);
  const nextInstallmentNumber = installmentPlan?.nextInstallment?.installmentNumber ?? 1;
  // Ya confirmado con alguna cuota pagada: quedan cuotas por pagar, pero ya no se puede rechazar
  const alreadyAccepted = quote.status === "aceptado";
  const payAmountEuros = payAmountCents / 100;

  function formatInstallmentStatus(s: string) {
    const map: Record<string, string> = { pending: "Pendiente", paid: "Pagada", overdue: "Vencida", cancelled: "Cancelada" };
    return map[s] ?? s;
  }

  const itemsTable = (
    <div className="px-4 sm:px-6 py-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-2">Concepto</th>
            <th className="text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-2 w-12">Uds.</th>
            <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-2 w-24">Precio</th>
            <th className="text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide pb-2 w-24">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="py-3 pr-2 text-foreground font-medium break-words">{item.description}</td>
              <td className="py-3 text-center text-muted-foreground">{item.quantity}</td>
              <td className="py-3 text-right text-muted-foreground whitespace-nowrap">{formatCurrency(item.unitPrice)}</td>
              <td className="py-3 text-right font-semibold text-foreground whitespace-nowrap">{formatCurrency(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const totals = (totalLabel: string, showSubtotalAlways: boolean) => (
    <div className="px-4 sm:px-6 py-4 bg-muted/50 border-t border-border">
      <div className="flex flex-col items-end gap-1 text-sm">
        {(showSubtotalAlways || Number(quote.subtotal) > 0) && (
          <div className="flex justify-between w-56">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-foreground">{formatCurrency(quote.subtotal)}</span>
          </div>
        )}
        {Number(quote.discount) > 0 && (
          <div className="flex justify-between w-56">
            <span className="text-muted-foreground">Descuento</span>
            <span className="text-success">-{formatCurrency(quote.discount)}</span>
          </div>
        )}
        {Number(quote.tax) > 0 && (
          <div className="flex justify-between w-56">
            <span className="text-muted-foreground">IVA</span>
            <span className="text-foreground">{formatCurrency(quote.tax)}</span>
          </div>
        )}
        <Separator className="w-56 my-1" />
        <div className="flex justify-between items-baseline w-56">
          <span className="font-bold text-foreground text-base">{totalLabel}</span>
          <span className="font-bold text-foreground text-xl">{formatCurrency(quote.total)}</span>
        </div>
      </div>
    </div>
  );

  const titleBand = (heading: "h1" | "h2") => {
    const H = heading;
    return (
      <div className="bg-primary text-primary-foreground px-4 sm:px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider mb-1">Presupuesto {quote.quoteNumber}</p>
            <H className="text-xl font-bold leading-tight break-words">{quote.title}</H>
          </div>
          <FileText className="w-8 h-8 opacity-60 flex-shrink-0 mt-1" aria-hidden="true" />
        </div>
      </div>
    );
  };

  const installments = (withIntro: boolean) =>
    installmentPlan && installmentPlan.installments.length > 0 ? (
      <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="bg-muted/60 border-b border-border px-4 sm:px-6 py-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <h2 className="text-foreground font-bold text-base">Plan de pago fraccionado</h2>
          </div>
          {withIntro && (
            <p className="text-muted-foreground text-xs mt-1">
              Este presupuesto se abona en {installmentPlan.installments.length} cuota{installmentPlan.installments.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="divide-y divide-border">
          {installmentPlan.installments.map((inst) => {
            const isPaid = inst.status === "paid";
            const isOverdue = inst.status === "overdue";
            const isRequired = (inst as { isRequiredForConfirmation?: boolean }).isRequiredForConfirmation;
            return (
              <div key={inst.id} className={`px-4 sm:px-6 py-4 flex items-center justify-between gap-3 ${isPaid ? "bg-success/10" : isOverdue ? "bg-danger/10" : ""}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 border ${isPaid ? TONE_BADGE.success : isOverdue ? TONE_BADGE.danger : TONE_BADGE.neutral}`}>
                    {isPaid ? <Check className="w-4 h-4" aria-label="Pagada" /> : inst.installmentNumber}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      Cuota {inst.installmentNumber}
                      {withIntro && isRequired && <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full border ${TONE_BADGE.brand}`}>Se paga al aceptar</span>}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="w-3 h-3" /> Vence: {formatDate(inst.dueDate)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-base text-foreground">{formatCurrency(inst.amountCents / 100)}</p>
                  <p className={`text-xs ${isPaid ? "text-success" : isOverdue ? "text-danger" : "text-muted-foreground"}`}>
                    {formatInstallmentStatus(inst.status)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const footer = (
    <div className="text-center text-muted-foreground text-xs pb-8 space-y-1">
      <p>¿Tienes dudas? Contacta con nosotros</p>
      <div className="flex flex-wrap justify-center gap-4">
        {phoneTel && (
          <a href={phoneTel} className="text-foreground underline-offset-2 hover:underline flex items-center gap-1">
            <Phone className="w-3 h-3" /> {phone || "Teléfono"}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="text-foreground underline-offset-2 hover:underline flex items-center gap-1">
            <Mail className="w-3 h-3" /> {email}
          </a>
        )}
      </div>
    </div>
  );

  // -- Already paid --
  if (quote.isPaid) {
    // En la instalación original, «reserva»; en la web de cualquier otra empresa, presupuesto pagado
    const paidTitle = neutral ? "Presupuesto pagado" : "Reserva confirmada";
    return page(
      <>
        <BrandHeader
          logoUrl={logoUrl}
          brandName={brandName}
          subtitle={paidTitle}
          right={<Badge variant="outline" className={`${TONE_BADGE.success} border text-xs font-medium shrink-0`}>Aceptado y pagado</Badge>}
        />

        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <div className={`border rounded-2xl px-6 py-5 flex items-center gap-4 ${TONE_SURFACE.success}`}>
            <div className="w-14 h-14 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <div>
              <h1 className="text-foreground text-xl font-bold">¡{paidTitle}!</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Tu pago se ha procesado correctamente. Recibirás la factura por email.
              </p>
            </div>
          </div>

          <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm overflow-hidden">
            {titleBand("h2")}
            <div className="px-4 sm:px-6 py-4 bg-muted/50 border-b border-border">
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">Cliente</span>
                  <p className="font-medium text-foreground">{quote.clientName}</p>
                </div>
                {quote.invoiceNumber && (
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wide">Factura</span>
                    <p className="font-medium text-foreground">{quote.invoiceNumber}</p>
                  </div>
                )}
              </div>
            </div>
            {itemsTable}
            {totals("Total pagado", false)}
          </div>

          {installments(false)}

          {quote.invoicePdfUrl && (
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6 text-center">
              <Button asChild className="px-6 py-3 rounded-xl text-sm font-semibold">
                <a href={quote.invoicePdfUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="w-4 h-4 mr-2" /> Descargar factura
                </a>
              </Button>
            </div>
          )}

          {footer}
        </main>
      </>
    );
  }

  // -- Rejected --
  if (quote.isRejected || rejected) {
    return centered(
      <NoticeCard icon={<XCircle className="w-16 h-16 text-danger mx-auto mb-4" />} title="Presupuesto rechazado" contact={callLink}>
        Has rechazado este presupuesto. Si cambias de opinión o quieres hablar con nosotros, no dudes en contactarnos.
      </NoticeCard>
    );
  }

  // -- Expired --
  if (quote.isExpired) {
    return centered(
      <NoticeCard icon={<Clock className="w-16 h-16 text-warning mx-auto mb-4" />} title="Presupuesto expirado" contact={callLink}>
        Este presupuesto expiró el {formatDate(quote.validUntil)}. Contacta con nosotros para solicitar uno nuevo.
      </NoticeCard>
    );
  }

  // -- Main view --
  return page(
    <>
      <BrandHeader logoUrl={logoUrl} brandName={brandName} subtitle="Presupuesto personalizado" right={<StatusBadge status={quote.status} isExpired={quote.isExpired} />} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* Aviso de pago fallido */}
        {quote.status === "pago_fallido" && (
          <div className={`border rounded-xl px-5 py-4 flex gap-3 items-start ${TONE_SURFACE.warning}`}>
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-foreground font-semibold text-sm">El pago anterior no se completó</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Puedes intentarlo de nuevo con otra tarjeta. El presupuesto sigue siendo válido.
              </p>
            </div>
          </div>
        )}

        <div className="bg-card text-card-foreground border border-border rounded-2xl shadow-sm overflow-hidden">
          {titleBand("h1")}
          <div className="px-4 sm:px-6 py-4 bg-muted/50 border-b border-border">
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground text-xs uppercase tracking-wide">Para</span>
                <p className="font-medium text-foreground">{quote.clientName}</p>
              </div>
              {quote.validUntil && (
                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wide">Válido hasta</span>
                  <p className="font-medium text-foreground">{formatDate(quote.validUntil)}</p>
                </div>
              )}
            </div>
          </div>
          {itemsTable}
          {totals("Total", true)}
        </div>

        {installments(true)}

        {quote.notes && (
          <div className="bg-card border border-border rounded-xl shadow-sm p-5">
            <h3 className="text-sm font-semibold text-foreground mb-2">Notas del presupuesto</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{quote.notes}</p>
          </div>
        )}

        {quote.conditions && (
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-foreground hover:bg-muted/60 transition-colors"
              onClick={() => setShowConditions(!showConditions)}
              aria-expanded={showConditions}
            >
              <span>Condiciones</span>
              {showConditions ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showConditions && (
              <div className="px-5 pb-4 border-t border-border">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed pt-3">{quote.conditions}</p>
              </div>
            )}
          </div>
        )}

        {/* Aceptar (pagar) o rechazar */}
        {canAct && (
          <div className="bg-card border border-border rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <ShieldCheck className="w-4 h-4 text-success shrink-0" />
              <span>Pago con tarjeta seguro · conexión cifrada</span>
            </div>

            <Button
              className="w-full h-auto min-h-12 whitespace-normal font-bold text-base py-3 rounded-xl"
              onClick={() => payMutation.mutate({ token: token!, origin: window.location.origin })}
              disabled={payMutation.isPending}
            >
              {payMutation.isPending ? (
                <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Preparando el pago...</>
              ) : installmentPlan ? (
                <><CreditCard className="w-5 h-5 mr-2 shrink-0" /> Pagar cuota {nextInstallmentNumber}: {formatCurrency(payAmountEuros)}</>
              ) : (
                <><CreditCard className="w-5 h-5 mr-2 shrink-0" /> Aceptar y pagar {formatCurrency(quote.total)}</>
              )}
            </Button>
            {installmentPlan && (
              <p className="text-center text-xs text-muted-foreground">
                Importe total del presupuesto: {formatCurrency(quote.total)} · Pago fraccionado en {installmentPlan.installments.length} cuotas
              </p>
            )}

            {alreadyAccepted ? null : !showRejectForm ? (
              <button
                className="w-full text-sm text-muted-foreground hover:text-danger transition-colors py-2"
                onClick={() => setShowRejectForm(true)}
              >
                No me interesa — Rechazar presupuesto
              </button>
            ) : (
              <div className={`border rounded-xl p-4 space-y-3 ${TONE_SURFACE.danger}`}>
                <p className="text-sm font-medium text-foreground">¿Seguro que quieres rechazar este presupuesto?</p>
                <Textarea
                  placeholder="Motivo del rechazo (opcional)..."
                  className="text-sm resize-none bg-background"
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowRejectForm(false)}>
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
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

        {footer}
      </main>
    </>
  );
}
