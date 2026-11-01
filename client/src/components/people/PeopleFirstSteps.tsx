/**
 * Primeros pasos de Personal al activar la extensión: configuración básica, primer empleado, su horario e invitación
 * al portal. Cada paso se marca solo con los datos de la empresa (hr.onboarding.status). Desaparece al completarlos.
 */
import { Link } from "wouter";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import { trpc } from "@/lib/trpc";

export default function PeopleFirstSteps() {
  const { data } = trpc.hr.onboarding.status.useQuery();
  if (!data || data.allDone) return null;
  return (
    <section aria-labelledby="personal-primeros-pasos" className="rounded-xl border border-orange-500/30 bg-orange-500/[0.04] p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 id="personal-primeros-pasos" className="text-sm font-semibold text-foreground">Primeros pasos con Personal</h2>
        <span className="text-xs text-foreground/50">{data.completed} de {data.total}</span>
      </div>
      <ol className="space-y-1.5">
        {data.steps.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-foreground/[0.04]">
              {s.done ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" /> : <Circle className="w-4 h-4 mt-0.5 shrink-0 text-foreground/30" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${s.done ? "text-foreground/50 line-through" : "text-foreground font-medium"}`}>{s.title}</span>
                {!s.done && <span className="block text-xs text-foreground/50">{s.description}</span>}
              </span>
              <span className="sr-only">{s.done ? "Hecho" : "Pendiente"}</span>
              {!s.done && <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-foreground/30 group-hover:text-foreground/60" aria-hidden="true" />}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
