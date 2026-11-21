/**
 * Estado de configuración en el Inicio. Única fuente: el recorrido del asistente (`setupWizard.status.plan`), el
 * mismo que se ve en «Primeros pasos»: mismos pasos, mismo orden y mismo estado real.
 */
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, SkipForward } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { STEP_LABELS, configurationSteps, type SetupPlan } from "@shared/setupWizard";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";
import { useI18n } from "@/i18n/I18nProvider";

export function SetupStatusCard({ plan }: { plan: SetupPlan }) {
  const { t } = useI18n();
  const stepTitle = (id: keyof typeof STEP_LABELS): string => t(`onboardingShared.step.${id}`);
  const steps = configurationSteps(plan.steps);
  const pending = steps.filter((s) => s.status !== "done");
  const next = plan.nextStep && plan.nextStep !== "welcome" ? plan.nextStep : null;
  return (
    <section aria-labelledby="home-setup" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="home-setup" className="font-semibold text-foreground">{t("onboardingShared.status.title")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pending.length === 0 ? t("onboardingShared.status.allDone") : t("onboardingShared.status.progress", { done: steps.length - pending.length, total: steps.length })}
          </p>
        </div>
        <span className="text-sm font-medium tabular-nums text-foreground">{plan.percent}%</span>
      </div>
      <Progress value={plan.percent} className="mt-3 h-2" aria-label={t("onboardingShared.status.ariaProgress")} aria-valuetext={t("onboardingShared.status.completed", { percent: plan.percent })} />
      {pending.length > 0 && (
        <ul className="mt-4 space-y-1">
          {pending.slice(0, 4).map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              {s.status === "skipped" ? (
                <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-foreground">{stepTitle(s.id)}</span>
              <span className="text-xs text-muted-foreground">{s.status === "skipped" ? t("onboardingShared.status.skipped") : s.recommended ? t("onboardingShared.status.recommended") : t("onboardingShared.status.pending")}</span>
            </li>
          ))}
          {pending.length > 4 && <li className="text-xs text-muted-foreground">{t("onboardingShared.status.more", { n: pending.length - 4 })}</li>}
        </ul>
      )}
      {pending.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {t("onboardingShared.status.basicsReady")}
        </p>
      )}
      <Link
        href={SETUP_WIZARD_PATH}
        className="mt-4 inline-flex items-center gap-1 rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {next ? t("onboardingShared.status.continue", { step: stepTitle(next) }) : t("onboardingShared.status.review")} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

export default SetupStatusCard;
