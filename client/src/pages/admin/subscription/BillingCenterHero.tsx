/**
 * Cabecera premium del centro de suscripción. Banda con degradado derivado del color de marca de la empresa
 * (`--tenant-primary`, ver subscriptionStage.css: color-mix con tinta oscura para que el texto blanco conserve contraste AA
 * con cualquier color primario) y, dentro, lo que importa de un vistazo: estado y mensaje principal de la etapa, plan en
 * prueba y plan contratado, y el próximo cobro con su importe estimado en cifras grandes.
 * Lo que NO dice la cabecera (método de pago, último cobro, periodo) va en las tarjetas de debajo, sin repetirse.
 * Todo sale de `TenantBillingCenter`; aquí solo se pinta. «Autorizado» no es «cobrado» y la prueba no es el plan contratado.
 */
import { AlertTriangle, ArrowRight, ArrowUpRight, CalendarClock, CheckCircle2, Info, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { BillingStage, TenantBillingCenter } from "@shared/billingCenter";

/** Indicador de estado sobre la banda oscura (clases `sx-status-*` de subscriptionStage.css). */
const STAGE_PILL: Record<BillingStage, "info" | "success" | "warning" | "danger" | "neutral"> = {
  no_contract: "neutral",
  contract_pending_payment: "warning",
  trial_authorized: "info",
  active: "success",
  payment_issue: "danger",
  suspended: "danger",
  canceled: "neutral",
};

export function BillingCenterHero({ center, onPortal, portalBusy }: { center: TenantBillingCenter; onPortal: () => void; portalBusy: boolean }) {
  const { t, format: f } = useI18n();
  const date = (ms: number | null | undefined) => (ms ? f.date(ms, { day: "numeric", month: "short", year: "numeric" }) : null);
  const stage = center.stage;
  const next = center.nextCharge;
  const nextDate = date(next?.at);
  const estimated = next?.estimatedTotalCents != null ? f.currency(next.estimatedTotalCents / 100, next.currency) : null;
  const last = center.lastPayment;
  const planName = center.contracted?.planName ?? null;
  const trialPlan = center.trial?.planName ?? null;
  const interval = center.fee?.interval ?? center.contracted?.interval ?? null;
  const intervalLabel = interval === "year" ? t("subscription.center.plan.perYear") : interval === "month" ? t("subscription.center.plan.perMonth") : null;
  const noPortal = !center.actions.portal;

  const headline = {
    no_contract: t("subscription.center.stage.no_contract"),
    contract_pending_payment: t("subscription.center.notice.pendingTitle"),
    trial_authorized: t("subscription.center.notice.trialTitle"),
    active: t("subscription.center.hero.activeTitle"),
    payment_issue: t("subscription.center.notice.issueTitle"),
    suspended: t("subscription.center.notice.suspendedTitle"),
    canceled: t("subscription.center.notice.canceledTitle"),
  }[stage];
  const detailText = {
    no_contract: null,
    contract_pending_payment: t("subscription.center.notice.pendingText"),
    trial_authorized: null,
    active: t("subscription.center.hero.activeText"),
    payment_issue: noPortal ? t("subscription.center.notice.issueTextNoPortal") : t("subscription.center.notice.issueText"),
    suspended: noPortal ? t("subscription.center.notice.suspendedTextNoPortal") : t("subscription.center.notice.suspendedText"),
    canceled: t("subscription.center.notice.canceledText"),
  }[stage];
  const Icon = stage === "payment_issue" || stage === "suspended" || stage === "contract_pending_payment" ? AlertTriangle : stage === "active" ? CheckCircle2 : stage === "trial_authorized" ? Sparkles : Info;

  // Frases cortas con lo que todavía no ha pasado (cobro) y lo previsto
  const facts: string[] = [];
  if (!last && (stage === "trial_authorized" || stage === "contract_pending_payment")) facts.push(t("subscription.center.hero.noChargeYet"));
  if (next && nextDate && stage !== "canceled") facts.push(t(next.basis === "trial_end" ? "subscription.center.hero.firstCharge" : "subscription.center.hero.nextCharge", { date: nextDate }));

  const showTrialPlan = !!trialPlan && !!planName && trialPlan !== planName;
  return (
    <header className="bc-hero p-5 sm:p-8 lg:p-10">
      <div className="relative space-y-6 sm:space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
              {center.company.name ? `${center.company.name} · ` : ""}
              {t("subscription.center.hero.eyebrow")}
            </p>
            <h1 className="mt-1 break-words text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t("subscription.center.title")}</h1>
          </div>
          {center.actions.portal && (
            <Button
              type="button"
              variant="outline"
              disabled={portalBusy}
              onClick={onPortal}
              className="h-11 rounded-xl border-white/40 bg-black/25 px-5 font-semibold text-white hover:bg-black/40 hover:text-white"
            >
              {portalBusy ? t("subscription.common.opening") : t("subscription.center.actions.portal")}
              <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-stretch lg:gap-8">
          {/* Estado y mensaje principal */}
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold", `sx-status-${STAGE_PILL[stage]}`)}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t(`subscription.center.stage.${stage}`)}
              </p>
              {center.customTerms && <p className="sx-status-neutral inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold">{t("subscription.center.customTerms")}</p>}
            </div>
            <div role="status" className="flex gap-3">
              <Icon className="mt-1.5 h-6 w-6 shrink-0 text-white" aria-hidden="true" />
              <div className="min-w-0 space-y-2">
                <h2 className="text-balance break-words text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl lg:text-4xl">{headline}</h2>
                {facts.map((x) => (
                  <p key={x} className="text-base font-semibold text-white/95 sm:text-lg">
                    {x}
                  </p>
                ))}
                {detailText && <p className="max-w-2xl text-sm text-white/85 sm:text-base">{detailText}</p>}
              </div>
            </div>
          </div>

          {/* Planes y próximo cobro */}
          <section aria-label={t("subscription.center.summary.nextCharge")} className="bc-glass flex min-w-0 flex-col justify-between gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              {showTrialPlan && (
                <>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white/75">{t("subscription.center.hero.trialPlan")}</p>
                    <p className="break-words text-lg font-bold text-white">{trialPlan}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-white/70" aria-hidden="true" />
                </>
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium text-white/75">{t("subscription.center.summary.plan")}</p>
                <p className="break-words text-lg font-bold text-white">
                  {planName ?? t("subscription.center.summary.noPlan")}
                  {intervalLabel && planName && <span className="ml-2 text-sm font-medium text-white/75">{intervalLabel}</span>}
                </p>
              </div>
            </div>
            <div className="border-t border-white/15 pt-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-white/75">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("subscription.center.summary.nextCharge")}
              </p>
              <p className="mt-1 break-words text-4xl font-extrabold leading-none tracking-tight tabular-nums text-white sm:text-5xl">
                {nextDate ?? (next ? t("subscription.center.summary.toBeConfirmed") : "—")}
              </p>
              <p className="mt-2 text-sm text-white/85">
                {estimated ? (
                  <>
                    {t("subscription.center.hero.estimatedLabel")}: <strong className="text-xl font-extrabold tabular-nums text-white sm:text-2xl">{estimated}</strong>
                  </>
                ) : next ? null : (
                  t("subscription.center.summary.notScheduled")
                )}
              </p>
            </div>
          </section>
        </div>
      </div>
    </header>
  );
}
