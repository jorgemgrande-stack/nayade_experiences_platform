/**
 * Aviso único de recuperación comercial (prueba o suscripción terminada, pago pendiente o restricción): una sola vez
 * por pantalla, encima del contenido, con la acción que corresponde al estado real de la empresa. Los textos y el
 * destino salen de shared/subscriptionRecovery.ts; los datos, del servidor (subscription.*).
 *
 * Solo presentación: el servidor sigue bloqueando la escritura y los permisos vuelven cuando el plano de control aplica
 * la suscripción pagada (webhook). Al volver a estar activa, la consulta periódica de la suscripción retira el aviso.
 */
import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, ArrowRight, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { setRecoveryView } from "@/lib/readOnlyBlock";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { SUBSCRIPTION_PATH, isPanelReadOnlyState, resolveRecovery } from "@shared/subscriptionRecovery";

export function SubscriptionRecoveryBanner({ role }: { role: string }) {
  const sub = usePanelSubscription();
  const [location] = useLocation();
  const data = sub.data;
  const licensed = sub.mode === "tasks" && data?.licensing === "capabilities";
  const isAdmin = role === "admin";
  // Contrato y cobro (solo la administración y solo con el panel en consulta): distinguen el pago pendiente
  const restrictedState = isPanelReadOnlyState(data?.state);
  const contract = trpc.subscription.plan.useQuery(undefined, { enabled: licensed && isAdmin && restrictedState, retry: false, staleTime: 120_000, refetchOnWindowFocus: false });
  const pendingPayment = !!contract.data && resolveRecovery({ overview: data, contract: contract.data, isAdmin })?.kind === "payment_pending";
  const portal = trpc.subscription.billingPortalStatus.useQuery(undefined, { enabled: pendingPayment, retry: false, staleTime: 300_000 });
  const conversion = trpc.subscription.conversionStatus.useQuery(undefined, { enabled: licensed && isAdmin && data?.state === "trial_expired", retry: false, staleTime: 300_000 });
  const openPortal = trpc.subscription.billingPortal.useMutation({
    onSuccess: (r) => window.location.assign((r as { url: string }).url),
    onError: (e) => toast.error(e.message),
  });

  // Mientras llega el contrato no se pinta nada (evita que el aviso cambie de contenido al cargar)
  const waitingContract = isAdmin && restrictedState && contract.isLoading;
  const view = licensed && !waitingContract
    ? resolveRecovery({ overview: data, contract: contract.data ?? null, isAdmin, portalEnabled: !!portal.data?.enabled, conversionEnabled: !!conversion.data?.enabled })
    : null;
  // El aviso al intentar guardar (manejador global) usa este mismo estado
  const viewKey = JSON.stringify(view);
  useEffect(() => {
    setRecoveryView(viewKey === "null" ? null : JSON.parse(viewKey));
  }, [viewKey]);

  // En «Suscripción» la propia página ya explica el estado y ofrece la contratación: no se repite
  if (!view || location === SUBSCRIPTION_PATH || location === SUBSCRIPTION_PATH + "/exportar") return null;

  const Icon = view.kind === "restricted" ? LifeBuoy : AlertTriangle;
  const cta = view.cta;
  return (
    <section
      aria-labelledby="aviso-suscripcion"
      className={cn("mb-6 sm:mb-8 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5", TONE_SURFACE[view.tone])}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span className={cn("mt-0.5 shrink-0", TONE_TEXT[view.tone])} aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="aviso-suscripcion" className="font-semibold text-foreground">{view.title}</h2>
          <p className="mt-0.5 text-sm text-foreground/90">{view.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">{view.secondary}</p>
        </div>
      </div>
      {cta && (
        <div className="shrink-0 sm:pl-2">
          {cta.action.type === "portal" ? (
            <Button type="button" className="w-full sm:w-auto" disabled={openPortal.isPending} onClick={() => openPortal.mutate()}>
              {openPortal.isPending ? "Abriendo…" : cta.label}
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button asChild className="w-full sm:w-auto">
              <Link href={cta.action.href}>
                {cta.label}
                <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
