/**
 * Guía breve de la primera sesión de una empresa en prueba (shared/trialFirstSteps.ts): datos de la empresa, primer
 * cliente y primer presupuesto, con su estado real. Se puede ocultar y volver a mostrar (preferencia de este
 * navegador); desaparece sola cuando los tres pasos están hechos. Nunca bloquea ni pide datos fiscales.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { FIRST_STEPS_HIDDEN_KEY, trialFirstSteps, type FirstStepFacts } from "@shared/trialFirstSteps";

const readHidden = () => {
  try {
    return window.localStorage.getItem(FIRST_STEPS_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};
const writeHidden = (v: boolean) => {
  try {
    if (v) window.localStorage.setItem(FIRST_STEPS_HIDDEN_KEY, "1");
    else window.localStorage.removeItem(FIRST_STEPS_HIDDEN_KEY);
  } catch {
    /* sin almacenamiento: solo dura esta visita */
  }
};

export function TrialFirstSteps({ facts, can }: { facts: FirstStepFacts; can: { clients: boolean; quotes: boolean } }) {
  const [hidden, setHidden] = useState(readHidden);
  const steps = trialFirstSteps(facts, can);
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const toggle = (v: boolean) => {
    writeHidden(v);
    setHidden(v);
  };
  if (hidden) {
    return (
      <p className="text-sm text-muted-foreground" data-trial-first-steps="hidden">
        Guía de primeros pasos oculta ({done} de {steps.length} hechos).{" "}
        <button type="button" onClick={() => toggle(false)} className="font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          Mostrarla
        </button>
      </p>
    );
  }
  return (
    <section aria-labelledby="trial-first-steps" className="rounded-2xl border border-primary/30 bg-primary/5 p-5" data-trial-first-steps="open">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="trial-first-steps" className="font-semibold text-foreground">Empieza en tres pasos</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {done} de {steps.length} hechos. Puedes hacerlos en el orden que quieras y retomarlos cuando vuelvas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggle(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Ocultar
        </button>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0 rounded-xl border border-border bg-card p-4 flex flex-col" data-step={s.id} data-done={s.done ? "1" : "0"}>
            <p className="flex items-center gap-2 font-medium text-foreground">
              {s.done ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" /> : <Circle className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0">
                {i + 1}. {s.title}
                <span className="sr-only">{s.done ? " (hecho)" : " (pendiente)"}</span>
              </span>
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            {!s.done && (
              <Link href={s.href} className="mt-auto pt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {s.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default TrialFirstSteps;
