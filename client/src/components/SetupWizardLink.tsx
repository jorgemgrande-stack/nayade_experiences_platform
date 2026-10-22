/**
 * Acceso a «Primeros pasos» para enlazar desde el menú, el panel o un aviso. Muestra el avance y
 * desaparece cuando el asistente está terminado (o si el usuario no puede configurar la empresa).
 */
import { Link } from "wouter";
import { Rocket } from "lucide-react";
import { trpc } from "@/lib/trpc";

export const SETUP_WIZARD_PATH = "/admin/primeros-pasos";

export function SetupWizardLink({ className = "" }: { className?: string }) {
  const { data } = trpc.setupWizard.status.useQuery(undefined, { retry: false, staleTime: 60_000 });
  if (!data || data.progress.completedAt) return null;
  return (
    <Link
      href={SETUP_WIZARD_PATH}
      className={`inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      <Rocket className="h-4 w-4" aria-hidden="true" />
      <span>Primeros pasos</span>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs" aria-label={`${data.percent}% completado`}>
        {data.percent}%
      </span>
    </Link>
  );
}

export default SetupWizardLink;
