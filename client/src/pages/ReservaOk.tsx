/**
 * /reserva/ok — Página de retorno tras el pago en Redsys.
 * IMPORTANTE: Esta página NO confirma el pago. Solo consulta el estado real
 * de la reserva en backend. El pago se confirma ÚNICAMENTE por el endpoint
 * IPN /api/redsys/notification que valida la firma Redsys.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle, Clock, XCircle, ArrowRight, Phone, Mail, RefreshCw } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { formatDayEs } from "@shared/formatDay";
import { usePublicContact } from "@/hooks/usePublicPhone";
import { useMarketingConsent } from "@/hooks/useMarketingConsent";
import { trackEvent } from "@/lib/meta-pixel/client";
import { usePublicSite } from "@/hooks/usePublicSite";
import { useCart } from "@/contexts/CartContext";

export default function ReservaOk() {
  const [merchantOrder, setMerchantOrder] = useState<string | null>(null);
  const { phone, phoneTel, email } = usePublicContact();
  const [pollCount, setPollCount] = useState(0);
  const hasConsent = useMarketingConsent();
  const purchaseFired = useRef(false);
  // Tienda de una pyme: «pedido» y vuelta a la tienda; en la instalación propia, los textos de siempre
  const { features, text } = usePublicSite();
  const generic = !features || features.licensed;
  const shopHref = features?.licensed && !features.store ? "/" : text.shopHref;
  // La tienda conserva el carrito durante el pago: se vacía al confirmarse
  const { clearCart } = useCart();
  const cartCleared = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get("Ds_Order") ?? params.get("order");
    if (order) setMerchantOrder(order);
  }, []);

  const { data, isLoading, error, refetch } = trpc.reservations.getStatus.useQuery(
    { merchantOrder: merchantOrder! },
    {
      enabled: !!merchantOrder,
      retry: 3,
      retryDelay: 2000,
      refetchInterval: false,
    }
  );

  useEffect(() => {
    if (data?.status !== "paid" || !features?.licensed || cartCleared.current) return;
    cartCleared.current = true;
    clearCart();
  }, [data?.status, features?.licensed, clearCart]);

  // Polling automático si el estado es pending_payment
  useEffect(() => {
    if (!merchantOrder) return;
    if (data?.status === "paid" || data?.status === "failed") return;
    if (pollCount >= 8) return;

    const timer = setTimeout(() => {
      refetch();
      setPollCount((c) => c + 1);
    }, 2000);

    return () => clearTimeout(timer);
  }, [data?.status, pollCount, merchantOrder, refetch]);

  // Purchase cliente — se dispara una sola vez cuando status === "paid"
  useEffect(() => {
    if (!hasConsent || !merchantOrder || data?.status !== "paid" || purchaseFired.current) return;
    purchaseFired.current = true;
    const paidCents = data.amountPaid ?? data.amountTotal;
    const valueEur = paidCents ? paidCents / 100 : 0;
    trackEvent(
      'Purchase',
      {
        content_ids: [String(merchantOrder)],
        content_name: data.productName,
        content_type: 'product',
        value: valueEur,
        currency: 'EUR',
        order_id: merchantOrder,
        num_items: data.people ?? 1,
      },
      {
        email: data.customerEmail ?? undefined,
        // external_id = merchantOrder ? permite deduplicación y matching offline en Meta
        external_id: merchantOrder,
      },
      { eventId: `purchase_${merchantOrder}` }
    ).catch(() => {});
  }, [hasConsent, merchantOrder, data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!merchantOrder) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Enlace inválido</h1>
          <p className="text-muted-foreground mb-6">No se encontró el número de pedido en la URL.</p>
          <Link href={shopHref} className="inline-flex items-center gap-2 text-primary hover:underline">
            Seguir comprando <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </PublicLayout>
    );
  }

  // Cargando o pendiente con polling activo
  if (isLoading || (data?.status === "pending_payment" && pollCount < 8)) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-10 h-10 text-amber-600 animate-pulse" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Validando tu pago…</h1>
          <p className="text-muted-foreground mb-2">
            Estamos confirmando la transacción con el banco. Esto puede tardar unos segundos.
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            {generic ? "N.º de pedido" : "Referencia"}: <span className="font-mono font-semibold text-foreground">{merchantOrder}</span>
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Comprobando estado… ({pollCount + 1}/8)
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Error de red o reserva no encontrada
  if (error || !data) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pago en proceso</h1>
          <p className="text-muted-foreground mb-4">
            No hemos podido confirmar el estado de tu {generic ? "pedido" : "reserva"} en este momento.
            Si el pago se realizó correctamente, quedará confirmado en unos minutos: vuelve a comprobarlo con la referencia.
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            Referencia: <span className="font-mono font-semibold text-foreground">{merchantOrder}</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => { setPollCount(0); refetch(); }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Comprobar de nuevo
            </button>
            <Link href={shopHref} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
              Seguir comprando <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-8 pt-8 border-t border-border text-sm text-muted-foreground">
            <p className="mb-3">¿Tienes dudas? Contacta con nosotros:</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href={phoneTel} className="flex items-center gap-2 hover:text-accent transition-colors">
                <Phone className="w-4 h-4" /> {phone}
              </a>
              {email && (
                <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-accent transition-colors">
                  <Mail className="w-4 h-4" /> {email}
                </a>
              )}
            </div>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Estado: FAILED / CANCELLED
  if (data.status === "failed" || data.status === "cancelled") {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pago no completado</h1>
          <p className="text-muted-foreground mb-6">
            El banco ha rechazado o cancelado la transacción. No se ha realizado ningún cargo.
          </p>
          <div className="bg-muted/50 rounded-xl p-5 mb-8 text-left space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Producto</span>
              <span className="font-medium text-foreground">{data.productName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{generic ? "N.º de pedido" : "Referencia"}</span>
              <span className="font-mono font-medium text-foreground">{merchantOrder}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={shopHref} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
              Intentar de nuevo <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm">
              Volver al inicio
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Estado: PAID ?
  if (data.status === "paid") {
    // Usar amountPaid si está disponible (importe real cobrado), si no amountTotal
    const paidCents = data.amountPaid ?? data.amountTotal;
    const amountEuros = paidCents ? formatEur(paidCents / 100) : null;
    const isQuotePayment = data.quoteSource === "presupuesto";
    if (generic && !isQuotePayment) {
      const lines = data.lines?.length ? data.lines : [{ productName: data.productName, quantity: data.people ?? 1, amountCents: data.amountTotal ?? 0 }];
      const paid = (data.orderPaidCents ?? 0) > 0 ? data.orderPaidCents! : (data.orderTotalCents ?? data.amountTotal ?? 0);
      const discount = (data.orderTotalCents ?? 0) > paid ? (data.orderTotalCents ?? 0) - paid : 0;
      return (
        <PublicLayout>
          <div className="container py-16 max-w-lg mx-auto">
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-emerald-600" />
              </div>
              <h1 className="text-3xl font-display font-bold text-foreground mb-2">¡Pedido confirmado!</h1>
              <p className="text-muted-foreground">Hemos recibido tu pago. Gracias por tu compra, {data.customerName}.</p>
            </div>
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5 mb-6 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Número de pedido</p>
              <p className="mt-1 font-mono text-2xl font-bold text-foreground break-all" data-testid="numero-pedido">{merchantOrder}</p>
              <p className="mt-1 text-xs text-muted-foreground">Indícalo si nos escribes sobre tu compra.</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-5 mb-6 space-y-3 text-sm">
              <h2 className="font-display font-semibold text-foreground text-lg border-b border-border pb-3">Resumen del pedido</h2>
              <ul className="space-y-2">
                {lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="min-w-0 break-words text-foreground">{l.productName} <span className="text-muted-foreground">× {l.quantity}</span></span>
                    <span className="shrink-0 font-medium text-foreground">{formatEur(l.amountCents / 100)}</span>
                  </li>
                ))}
              </ul>
              {discount > 0 && (
                <div className="flex justify-between text-emerald-700"><span>Descuento</span><span>-{formatEur(discount / 100)}</span></div>
              )}
              <div className="flex justify-between pt-3 border-t border-border">
                <span className="font-semibold text-foreground">Total pagado <span className="font-normal text-muted-foreground">(IVA incluido)</span></span>
                <span className="font-bold text-foreground text-lg">{formatEur(paid / 100)}</span>
              </div>
              {data.invoiceNumber && (
                <div className="flex justify-between text-xs text-muted-foreground"><span>Factura</span><span className="font-mono">{data.invoiceNumber}</span></div>
              )}
            </div>
            <div className="bg-muted/40 border border-border rounded-xl p-5 mb-8">
              <h3 className="font-semibold text-foreground mb-3">¿Qué pasa ahora?</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {data.buyerEmails ? (
                  <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />Te hemos enviado la confirmación a <span className="break-all font-medium text-foreground">{data.customerEmail}</span>.</li>
                ) : (
                  <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />Guarda el número de pedido: te servirá para cualquier consulta.</li>
                )}
                <li className="flex items-start gap-2"><CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />Preparamos tu pedido y te avisaremos si necesitamos algún dato.</li>
              </ul>
            </div>
            {(phone || email) && (
              <div className="text-center text-sm text-muted-foreground mb-8">
                <p className="mb-3">¿Tienes alguna pregunta?</p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  {phone && <a href={phoneTel} className="flex items-center justify-center gap-2 hover:text-primary transition-colors"><Phone className="w-4 h-4" /> {phone}</a>}
                  {email && <a href={`mailto:${email}`} className="flex items-center justify-center gap-2 hover:text-primary transition-colors break-all"><Mail className="w-4 h-4" /> {email}</a>}
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href={shopHref} className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
                Seguir comprando <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/" className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm">
                Volver al inicio
              </Link>
            </div>
          </div>
        </PublicLayout>
      );
    }
    return (
      <PublicLayout>
        <div className="container py-20 max-w-lg mx-auto">
          <div className="text-center mb-10">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground mb-2">
              ¡{isQuotePayment ? "Presupuesto pagado!" : "Reserva confirmada!"}
            </h1>
            <p className="text-muted-foreground">
              Tu pago se ha registrado correctamente. Guarda la referencia de pago para cualquier consulta.
            </p>
          </div>

          <div className="bg-card border border-border rounded-2xl p-6 mb-8 space-y-4">
            <h2 className="font-display font-semibold text-foreground text-lg border-b border-border pb-3">
              Resumen de tu {isQuotePayment ? "presupuesto" : "reserva"}
            </h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{isQuotePayment ? "Concepto" : "Actividad"}</span>
                <span className="font-medium text-foreground">{data.productName}</span>
              </div>
              {data.bookingDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fecha</span>
                  <span className="font-medium text-foreground">{formatDayEs(data.bookingDate)}</span>
                </div>
              )}
              {!isQuotePayment && data.people && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Personas</span>
                  <span className="font-medium text-foreground">{data.people}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente</span>
                <span className="font-medium text-foreground">{data.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Correo electrónico</span>
                <span className="font-medium text-foreground break-all">{data.customerEmail}</span>
              </div>
              {data.notes && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Notas</span>
                  <span className="font-medium text-foreground text-right max-w-[60%]">{data.notes}</span>
                </div>
              )}
              {amountEuros && (
                <div className="flex justify-between pt-3 border-t border-border">
                  <span className="font-semibold text-foreground">Total pagado</span>
                  <span className="font-bold text-emerald-600 text-lg">{amountEuros}</span>
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>Referencia de pago</span>
                <span className="font-mono">{merchantOrder}</span>
              </div>
            </div>
          </div>

          <div className="bg-accent/5 border border-accent/20 rounded-xl p-5 mb-8">
            <h3 className="font-semibold text-foreground mb-3">¿Qué pasa ahora?</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                Tu pago queda registrado con la referencia indicada arriba.
              </li>
              {isQuotePayment ? (
                <>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    Tu factura se ha generado automáticamente.
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    Nuestro equipo se pondrá en contacto contigo para coordinar los detalles.
                  </li>
                </>
              ) : (
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  Nuestro equipo se pondrá en contacto contigo para coordinar los detalles.
                </li>
              )}
            </ul>
          </div>

          <div className="text-center text-sm text-muted-foreground mb-8">
            <p className="mb-3">¿Tienes alguna pregunta?</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href={phoneTel} className="flex items-center gap-2 hover:text-accent transition-colors">
                <Phone className="w-4 h-4" /> {phone}
              </a>
              {email && (
                <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-accent transition-colors">
                  <Mail className="w-4 h-4" /> {email}
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href={shopHref} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
              Seguir comprando <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm">
              Volver al inicio
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // Estado: pending_payment tras agotar el polling
  return (
    <PublicLayout>
      <div className="container py-20 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
          <Clock className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Estamos validando tu pago</h1>
        <p className="text-muted-foreground mb-4">
          Tu transacción está siendo procesada por el banco. Si el pago es correcto,
          quedará confirmado en unos minutos: vuelve a comprobar el estado con la referencia.
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          Referencia: <span className="font-mono font-semibold text-foreground">{merchantOrder}</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => { setPollCount(0); refetch(); }}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Comprobar estado
          </button>
          <Link href={shopHref} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm">
            Seguir comprando <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
        <div className="mt-8 pt-8 border-t border-border text-sm text-muted-foreground">
          <p className="mb-3">¿Tienes dudas? Contacta con nosotros:</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href={phoneTel} className="flex items-center gap-2 hover:text-accent transition-colors">
              <Phone className="w-4 h-4" /> {phone}
            </a>
            {email && (
              <a href={`mailto:${email}`} className="flex items-center gap-2 hover:text-accent transition-colors">
                <Mail className="w-4 h-4" /> {email}
              </a>
            )}
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}


