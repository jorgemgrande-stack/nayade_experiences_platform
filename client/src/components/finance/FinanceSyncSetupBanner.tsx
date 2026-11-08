/**
 * Aviso de la puesta en marcha de Finance Sync en sus pantallas («Gestionar» abre Movimientos bancarios): mientras falte
 * el extracto o una fuente del datáfono, lleva a la pantalla de puesta en marcha. Desaparece al estar listo.
 */
import { Link } from "wouter";
import { ChevronRight, Rocket } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { FINANCE_SYNC_SETUP_PATH } from "@shared/financeSyncSetup";

export default function FinanceSyncSetupBanner() {
  const { data } = trpc.financeSync.setup.useQuery(undefined, { retry: false });
  if (!data || data.ready) return null;
  return (
    <Link
      href={FINANCE_SYNC_SETUP_PATH}
      className="group flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 hover:bg-amber-500/[0.1]"
    >
      <Rocket className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Termina la puesta en marcha de Finance Sync</span>
        <span className="block text-xs text-muted-foreground">
          {data.completed} de {data.total} pasos necesarios. {data.missing[0] ?? ""}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
    </Link>
  );
}
