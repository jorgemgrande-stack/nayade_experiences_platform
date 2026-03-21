/**
 * /restaurantes/reserva-ko — Retorno tras pago fallido/cancelado en Redsys.
 * Lee el localizador de la URL (?locator=NR-XXXXX) y muestra opciones de reintento.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  XCircle, ArrowRight, Phone, Mail, RefreshCw, UtensilsCrossed
} from "lucide-react";
import PublicLayout from "@/components/PublicLayout";
import { trpc } from "@/lib/trpc";

export default function RestauranteReservaKo() {
  const [locator, setLocator] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get("locator");
    if (loc) setLocator(loc);
  }, []);

  const { data } = trpc.restaurants.getBookingByLocator.useQuery(
    { locator: locator! },
    { enabled: !!locator, retry: 2 }
  );

  return (
    <PublicLayout>
      <div className="container py-20 text-center max-w-lg mx-auto">
        {/* Icono de error */}
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 flex items-center justify-center">
          <XCircle className="w-10 h-10 text-red-500" />
        </div>

        <h1 className="text-3xl font-display font-bold text-foreground mb-3">
          Pago no completado
        </h1>
        <p className="text-muted-foreground mb-8 max-w-sm mx-auto">
          El banco ha rechazado o cancelado la transacción.
          <strong className="text-foreground"> No se ha realizado ningún cargo</strong> en tu cuenta.
          Tu reserva queda en espera — puedes intentarlo de nuevo.
        </p>

        {/* Datos de la reserva si están disponibles */}
        {data && (
          <div className="bg-muted/50 rounded-xl p-5 mb-8 text-left space-y-2.5 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Localizador</span>
              <span className="font-mono font-semibold text-foreground tracking-wider">{locator}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Titular</span>
              <span className="font-medium text-foreground">{data.guestName}{data.guestLastName ? ` ${data.guestLastName}` : ""}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Fecha</span>
              <span className="font-medium text-foreground">{data.date} · {data.time}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Comensales</span>
              <span className="font-medium text-foreground">{data.guests} {data.guests === 1 ? "persona" : "personas"}</span>
            </div>
          </div>
        )}

        {!data && locator && (
          <div className="bg-muted/50 rounded-xl p-5 mb-8 text-sm text-muted-foreground">
            <p>Localizador: <span className="font-mono font-semibold text-foreground">{locator}</span></p>
          </div>
        )}

        {/* Posibles causas */}
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-5 mb-8 text-left">
          <h3 className="font-semibold text-foreground mb-3 text-sm">Posibles causas del error:</h3>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">·</span>
              Fondos insuficientes o límite de tarjeta superado.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">·</span>
              Datos de la tarjeta incorrectos o tarjeta caducada.
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">·</span>
              Pago bloqueado por el banco (contacta con tu entidad).
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">·</span>
              Sesión de pago expirada (más de 15 minutos).
            </li>
          </ul>
        </div>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <Link
            href="/restaurantes"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white text-sm font-medium"
            style={{ background: "linear-gradient(135deg, #f97316, #f59e0b)" }}
          >
            <RefreshCw className="w-4 h-4" /> Intentar de nuevo
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-border hover:bg-muted transition-colors text-sm"
          >
            Volver al inicio
          </Link>
        </div>

        {/* Contacto */}
        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          <p className="mb-3">¿Necesitas ayuda? Contacta con nosotros:</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="tel:+34930347791" className="flex items-center gap-2 hover:text-accent transition-colors">
              <Phone className="w-4 h-4" /> +34 930 34 77 91
            </a>
            <a href="mailto:reservas@nayadeexperiences.es" className="flex items-center gap-2 hover:text-accent transition-colors">
              <Mail className="w-4 h-4" /> reservas@nayadeexperiences.es
            </a>
          </div>
          <p className="mt-4 text-xs">
            También puedes{" "}
            <Link href="/restaurantes" className="text-accent hover:underline inline-flex items-center gap-1">
              <UtensilsCrossed className="w-3 h-3" /> ver todos los restaurantes
            </Link>
            {" "}y realizar una nueva reserva.
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
