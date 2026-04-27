/**
 * /reserva/error — Página de retorno cuando Redsys indica error o cancelación.
 * Muestra mensaje claro, datos básicos de la reserva y opción de reintentar.
 * El estado de la reserva se actualiza ÚNICAMENTE por el endpoint IPN.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { XCircle, ArrowRight, Phone, Mail, RefreshCw, AlertTriangle } from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";
import { usePublicPhone } from "@/hooks/usePublicPhone";

const REDSYS_ERROR_MESSAGES: Record<string, string> = {
  "0180": "Tarjeta ajena al servicio.",
  "0184": "Error en la autenticación del titular.",
  "0190": "Denegación sin especificar motivo.",
  "0191": "Fecha de caducidad errónea.",
  "0202": "Tarjeta en excepción transitoria o bajo sospecha de fraude.",
  "0904": "Comercio no registrado en FUC.",
  "0909": "Error de sistema.",
  "0912": "Emisor no disponible.",
  "0913": "Pedido repetido.",
  "9064": "Número de posiciones de la tarjeta incorrecto.",
  "9078": "No existe método de pago válido para esa tarjeta.",
  "9093": "Tarjeta no existente.",
  "9094": "Rechazo servidores internacionales.",
  "9218": "El comercio no permite operaciones seguras.",
  "9253": "Tarjeta no cumple el check-digit.",
  "9912": "Emisor no disponible.",
  "9915": "Has cancelado el proceso de pago.",
  "9997": "Se está procesando otra transacción con la misma tarjeta.",
  "9999": "Operación redirigida al emisor para autenticar.",
};

export default function ReservaError() {
  const { phone, phoneTel } = usePublicPhone();
  const [merchantOrder, setMerchantOrder] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get("Ds_Order") ?? params.get("order");
    const code = params.get("Ds_ErrorCode") ?? params.get("Ds_Response") ?? params.get("code");
    if (order) setMerchantOrder(order);
    if (code) setErrorCode(code);
  }, []);

  const { data: reservation } = trpc.reservations.getStatus.useQuery(
    { merchantOrder: merchantOrder! },
    { enabled: !!merchantOrder, retry: 2 }
  );

  const errorMessage = errorCode ? REDSYS_ERROR_MESSAGES[errorCode] : null;
  const isCancelled = errorCode === "9915";
  const canRetry = !reservation || reservation.status === "pending_payment" || reservation.status === "failed";

  return (
    <PublicLayout>
      <div className="container py-20 max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-10 h-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isCancelled ? "Pago cancelado" : "Pago no completado"}
          </h1>
          <p className="text-muted-foreground">
            {isCancelled
              ? "Has cancelado el proceso de pago. No se ha realizado ningún cargo en tu tarjeta."
              : "El banco no ha podido procesar el pago. No se ha realizado ningún cargo en tu tarjeta."}
          </p>
        </div>

        {(errorCode || errorMessage) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                {errorCode && (
                  <p className="text-sm font-semibold text-red-700 mb-1">
                    Código de error: {errorCode}
                  </p>
                )}
                <p className="text-sm text-red-600">
                  {errorMessage ?? "El banco ha rechazado la operación. Prueba con otra tarjeta o contacta con tu banco."}
                </p>
              </div>
            </div>
          </div>
        )}

        {reservation && (
          <div className="bg-muted/50 rounded-xl p-5 mb-6 space-y-2 text-sm">
            <h3 className="font-semibold text-foreground mb-3">Datos de tu reserva</h3>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Producto</span>
              <span className="font-medium text-foreground">{reservation.productName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha</span>
              <span className="font-medium text-foreground">{reservation.bookingDate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Personas</span>
              <span className="font-medium text-foreground">{reservation.people}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Importe</span>
              <span className="font-medium text-foreground">
                {reservation.amountTotal ? (reservation.amountTotal / 100).toFixed(2) + "€" : "—"}
              </span>
            </div>
            {merchantOrder && (
              <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                <span>Referencia</span>
                <span className="font-mono">{merchantOrder}</span>
              </div>
            )}
          </div>
        )}

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8">
          <h3 className="font-semibold text-amber-800 mb-2 text-sm">¿Qué puedo hacer?</h3>
          <ul className="space-y-1 text-sm text-amber-700">
            <li>• Comprueba que los datos de la tarjeta son correctos.</li>
            <li>• Verifica que tienes saldo o límite disponible.</li>
            <li>• Prueba con otra tarjeta de crédito o débito.</li>
            <li>• Si el problema persiste, contacta con tu banco.</li>
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
          {canRetry && (
            <Link
              href="/experiencias"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white text-sm font-semibold"
              style={{ background: 'linear-gradient(135deg, #f97316, #f59e0b)' }}
            >
              <RefreshCw className="w-4 h-4" /> Intentar de nuevo
            </Link>
          )}
          <Link
            href="/experiencias"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
          >
            Ver experiencias <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
          >
            Volver al inicio
          </Link>
        </div>

        <div className="text-center text-sm text-muted-foreground pt-6 border-t border-border">
          <p className="mb-3">¿Necesitas ayuda? Estamos aquí para ti:</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href={phoneTel} className="flex items-center gap-2 hover:text-accent transition-colors">
              <Phone className="w-4 h-4" /> {phone}
            </a>
            <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-2 hover:text-accent transition-colors">
              <Mail className="w-4 h-4" /> reservas@nayadeexperiences.es
            </a>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}


