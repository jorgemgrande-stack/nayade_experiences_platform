/**
 * /restaurantes/reserva-ok — Retorno tras pago Redsys de depósito de restaurante.
 * Lee el localizador de la URL (?locator=NR-XXXXX) y consulta el estado real en backend.
 * NUNCA confirma el pago solo por esta URL — el IPN /api/redsys/restaurant-notification
 * es el único que actualiza el estado de la reserva.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  CheckCircle, Clock, XCircle, ArrowRight,
  Phone, Mail, RefreshCw, UtensilsCrossed, CalendarDays, Users
} from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";

export default function RestauranteReservaOk() {
  const [locator, setLocator] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get("locator");
    if (loc) setLocator(loc);
  }, []);

  const { data, isLoading, error, refetch } = trpc.restaurants.getBookingByLocator.useQuery(
    { locator: locator! },
    {
      enabled: !!locator,
      retry: 3,
      retryDelay: 2000,
      refetchInterval: false,
    }
  );

  // Polling automático si el estado es pending_payment
  useEffect(() => {
    if (!locator) return;
    if (data?.status === "confirmed" || data?.status === "payment_failed") return;
    if (pollCount >= 8) return;

    const timer = setTimeout(() => {
      refetch();
      setPollCount((c) => c + 1);
    }, 2000);

    return () => clearTimeout(timer);
  }, [data?.status, pollCount, locator, refetch]);

  // ── Sin localizador ────────────────────────────────────────────────────────
  if (!locator) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Enlace inválido</h1>
          <p className="text-muted-foreground mb-6">
            No se encontró el localizador de reserva en la URL.
          </p>
          <Link href="/restaurantes" className="inline-flex items-center gap-2 text-accent hover:underline">
            Ver restaurantes <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </PublicLayout>
    );
  }

  // ── Cargando / pendiente con polling ──────────────────────────────────────
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
            Localizador: <span className="font-mono font-semibold text-foreground">{locator}</span>
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Comprobando estado… ({pollCount + 1}/8)
          </div>
        </div>
      </PublicLayout>
    );
  }

  // ── Error de red o reserva no encontrada ──────────────────────────────────
  if (error || !data) {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-amber-100 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pago en proceso</h1>
          <p className="text-muted-foreground mb-4">
            No hemos podido confirmar el estado de tu reserva en este momento.
            Si el pago se realizó correctamente, recibirás un email de confirmación en breve.
          </p>
          <p className="text-sm text-muted-foreground mb-8">
            Localizador: <span className="font-mono font-semibold text-foreground">{locator}</span>
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => { setPollCount(0); refetch(); }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Comprobar de nuevo
            </button>
            <Link
              href="/restaurantes"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white text-sm"
              style={{ background: "linear-gradient(135deg, #f97316, #f59e0b)" }}
            >
              Ver restaurantes <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-8 pt-8 border-t border-border text-sm text-muted-foreground">
            <p className="mb-3">¿Tienes dudas? Contacta con nosotros:</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href="tel:+34930347791" className="flex items-center gap-2 hover:text-accent transition-colors">
                <Phone className="w-4 h-4" /> +34 930 34 77 91
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

  // ── Estado: PAGO FALLIDO ──────────────────────────────────────────────────
  if (data.status === "payment_failed" || data.status === "cancelled") {
    return (
      <PublicLayout>
        <div className="container py-20 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pago no completado</h1>
          <p className="text-muted-foreground mb-6">
            El banco ha rechazado o cancelado la transacción. No se ha realizado ningún cargo.
            Tu reserva queda en espera — puedes intentarlo de nuevo.
          </p>
          <div className="bg-muted/50 rounded-xl p-5 mb-8 text-left space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Localizador</span>
              <span className="font-mono font-semibold text-foreground">{locator}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nombre</span>
              <span className="font-medium text-foreground">{data.guestName}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/restaurantes"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-white text-sm"
              style={{ background: "linear-gradient(135deg, #f97316, #f59e0b)" }}
            >
              Intentar de nuevo <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  // ── Estado: CONFIRMADA ✅ ─────────────────────────────────────────────────
  const depositEuros = data.depositAmount ? Number(data.depositAmount).toFixed(2) : null;
  const formattedDate = data.date
    ? new Date(data.date + "T12:00:00").toLocaleDateString("es-ES", {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      })
    : data.date;

  return (
    <PublicLayout>
      <div className="container py-20 max-w-lg mx-auto">
        {/* Cabecera de éxito */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground mb-2">
            ¡Reserva confirmada!
          </h1>
          <p className="text-muted-foreground">
            Tu depósito ha sido procesado correctamente. Recibirás un email de confirmación en breve.
          </p>
        </div>

        {/* Resumen de la reserva */}
        <div className="bg-card border border-border rounded-2xl p-6 mb-6 space-y-4">
          <h2 className="font-display font-semibold text-foreground text-lg border-b border-border pb-3 flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5 text-accent" />
            Resumen de tu reserva
          </h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <UtensilsCrossed className="w-3.5 h-3.5" /> Restaurante
              </span>
              <span className="font-semibold text-foreground text-right">{(data as any).restaurantName ?? "—"}</span>
            </div>
            <div className="flex justify-between items-start gap-4">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" /> Fecha y hora
              </span>
              <span className="font-medium text-foreground text-right capitalize">{formattedDate} · {data.time}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Comensales
              </span>
              <span className="font-medium text-foreground">{data.guests} {data.guests === 1 ? "persona" : "personas"}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Titular</span>
              <span className="font-medium text-foreground">{data.guestName}{data.guestLastName ? ` ${data.guestLastName}` : ""}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium text-foreground">{data.guestEmail}</span>
            </div>
            {depositEuros && Number(depositEuros) > 0 && (
              <div className="flex justify-between items-center pt-3 border-t border-border">
                <span className="font-semibold text-foreground">Depósito pagado</span>
                <span className="font-bold text-emerald-600 text-lg">{depositEuros}€</span>
              </div>
            )}
            <div className="flex justify-between items-center text-xs text-muted-foreground">
              <span>Localizador</span>
              <span className="font-mono font-semibold text-foreground tracking-wider">{locator}</span>
            </div>
          </div>
        </div>

        {/* ¿Qué pasa ahora? */}
        <div className="bg-accent/5 border border-accent/20 rounded-xl p-5 mb-8">
          <h3 className="font-semibold text-foreground mb-3">¿Qué pasa ahora?</h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Recibirás un email de confirmación con todos los detalles de tu reserva.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              El depósito se descontará del total de tu consumición en el restaurante.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              Cancelación gratuita hasta 48h antes de la reserva.
            </li>
          </ul>
        </div>

        {/* Contacto */}
        <div className="text-center text-sm text-muted-foreground mb-8">
          <p className="mb-3">¿Tienes alguna pregunta?</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="tel:+34930347791" className="flex items-center gap-2 hover:text-accent transition-colors">
              <Phone className="w-4 h-4" /> +34 930 34 77 91
            </a>
            <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-2 hover:text-accent transition-colors">
              <Mail className="w-4 h-4" /> reservas@nayadeexperiences.es
            </a>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/restaurantes"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white text-sm font-medium"
            style={{ background: "linear-gradient(135deg, #f97316, #f59e0b)" }}
          >
            <UtensilsCrossed className="w-4 h-4" /> Ver más restaurantes
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
