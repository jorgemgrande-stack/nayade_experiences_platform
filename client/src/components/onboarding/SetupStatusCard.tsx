/**
 * Estado de configuración en el Inicio. Única fuente: el recorrido del asistente (`setupWizard.status.plan`), el
 * mismo que se ve en «Primeros pasos»: mismos pasos, mismo orden y mismo estado real.
 */
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, SkipForward } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { STEP_LABELS, configurationSteps, type SetupPlan } from "@shared/setupWizard";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";

export function SetupStatusCard({ plan }: { plan: SetupPlan }) {
  const steps = configurationSteps(plan.steps);
  const pending = steps.filter((s) => s.status !== "done");
  const next = plan.nextStep && plan.nextStep !== "welcome" ? plan.nextStep : null;
  return (
    <section aria-labelledby="home-setup" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="home-setup" className="font-semibold text-foreground">Estado de la configuración</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pending.length === 0 ? "Todo configurado." : `${steps.length - pending.length} de ${steps.length} pasos hechos.`}
          </p>
        </div>
        <span className="text-sm font-medium tabular-nums text-foreground">{plan.percent}%</span>
      </div>
      <Progress value={plan.percent} className="mt-3 h-2" aria-label="Avance de la configuración" aria-valuetext={`${plan.percent}% completado`} />
      {pending.length > 0 && (
        <ul className="mt-4 space-y-1">
          {pending.slice(0, 4).map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              {s.status === "skipped" ? (
                <SkipForward className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              <span className="text-foreground">{STEP_LABELS[s.id].title}</span>
              <span className="text-xs text-muted-foreground">{s.status === "skipped" ? "omitido" : s.recommended ? "recomendado" : "pendiente"}</span>
            </li>
          ))}
          {pending.length > 4 && <li className="text-xs text-muted-foreground">y {pending.length - 4} más</li>}
        </ul>
      )}
      {pending.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Tu empresa tiene lo básico listo.
        </p>
      )}
      <Link
        href={SETUP_WIZARD_PATH}
        className="mt-4 inline-flex items-center gap-1 rounded text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {next ? `Continuar: ${STEP_LABELS[next].title}` : "Revisar la configuración"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

export default SetupStatusCard;
