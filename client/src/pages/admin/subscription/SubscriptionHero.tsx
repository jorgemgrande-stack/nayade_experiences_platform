/**
 * Cabecera premium y compacta de «Suscripción» (banda azul noche del marketplace): título de la página y, en un panel
 * de cristal, el plan, su estado, la fecha que importa, el cobro, qué pasa con los datos y la acción principal.
 * Todo el contenido sale de shared/subscriptionHeader.ts (estado real del servidor); aquí solo se pinta.
 */
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, ArrowUpRight, Building2, CalendarClock, CreditCard, Hourglass, Layers, Rocket, ShieldCheck, TrendingUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planPresentation, type PlanIconKey } from "@shared/planPresentation";
import type { HeaderAction, HeaderFact, SubscriptionHeaderModel } from "@shared/subscriptionHeader";

const PLAN_ICONS: Record<PlanIconKey, LucideIcon> = { rocket: Rocket, trending: TrendingUp, building: Building2, layers: Layers };
const FACT_ICONS: Record<HeaderFact["id"], LucideIcon> = { trial: Hourglass, renewal: CalendarClock, end: CalendarClock, amount: CreditCard, payment: CreditCard, grace: AlertTriangle };

export function SubscriptionHero({
  model,
  planKey,
  onAction,
  busy,
}: {
  model: SubscriptionHeaderModel | null;
  planKey: string | null;
  onAction: (a: HeaderAction) => void;
  /** Acción en curso (abrir el portal). */
  busy?: HeaderAction["kind"] | null;
}) {
  const pr = planPresentation({ key: planKey ?? "", tagline: null });
  const Icon = PLAN_ICONS[pr.icon];
  return (
    <header data-tone="violet" className="cx-on-image cx-tone-fallback relative overflow-hidden rounded-3xl border border-white/10 px-5 py-6 sm:px-8 sm:py-7">
      <div className="relative space-y-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">Elephant Core</p>
          <h1 className="mt-1 break-words text-3xl font-extrabold tracking-tight text-white sm:text-4xl">Suscripción</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/85 sm:text-base">Consulta tu plan, compara, contrata y gestiona tu suscripción. Para ampliar tu plataforma, visita el marketplace.</p>
        </div>

        {model && (
          <section aria-labelledby="sub-plan" className="sx-glass rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              <div className="flex min-w-0 items-center gap-3 lg:w-[17rem] lg:shrink-0">
                <span aria-hidden="true" data-tone={pr.tone} className="cx-tone-chip inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-lg shadow-black/30 sm:h-14 sm:w-14">
                  <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-white/75">{model.eyebrow}</p>
                  <h2 id="sub-plan" className="break-words text-2xl font-extrabold leading-tight text-white sm:text-3xl">
                    {model.planName}
                  </h2>
                </div>
              </div>

              <div className="hidden h-14 w-px bg-white/15 lg:block" aria-hidden="true" />

              <div className="min-w-0 flex-1 space-y-2">
                <p className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", `sx-status-${model.status.tone}`)}>
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {model.status.label}
                </p>
                {model.facts.length > 0 && (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                    {model.facts.map((f) => {
                      const FIcon = FACT_ICONS[f.id];
                      return (
                        <div key={f.id} className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                          <FIcon className={cn("h-4 w-4 shrink-0", f.tone === "warning" ? "text-amber-300" : f.tone === "success" ? "text-emerald-300" : "text-white/70")} aria-hidden="true" />
                          <dt className="text-white/75">{f.label}</dt>
                          <dd className="font-semibold text-white">{f.value}</dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
              </div>

              {(model.primary || model.secondary) && (
                <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
                  {model.secondary && <HeroButton action={model.secondary} onAction={onAction} busy={busy === model.secondary.kind} variant="outline" />}
                  {model.primary && <HeroButton action={model.primary} onAction={onAction} busy={busy === model.primary.kind} variant="primary" />}
                </div>
              )}
            </div>

            {(model.dataNote || model.restriction) && (
              <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                {model.dataNote && <p className="text-white/90">{model.dataNote}</p>}
                {model.restriction && (
                  <p className="flex items-start gap-1.5 text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0">{model.restriction}</span>
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </header>
  );
}

function HeroButton({ action, onAction, busy, variant }: { action: HeaderAction; onAction: (a: HeaderAction) => void; busy: boolean; variant: "primary" | "outline" }) {
  const cls =
    variant === "primary"
      ? "cx-cta h-11 rounded-xl px-5 font-semibold shadow-lg shadow-black/30 hover:bg-transparent"
      : "h-11 rounded-xl border-white/40 bg-white/5 px-5 font-semibold text-white hover:bg-white/15 hover:text-white";
  if (action.kind === "link") {
    return (
      <Button asChild variant={variant === "primary" ? "default" : "outline"} className={cls}>
        <Link href={action.href}>
          {action.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </Button>
    );
  }
  return (
    <Button type="button" variant={variant === "primary" ? "default" : "outline"} className={cls} disabled={busy} onClick={() => onAction(action)}>
      {busy ? "Abriendo…" : action.label}
      {action.kind === "portal" ? <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );
}
