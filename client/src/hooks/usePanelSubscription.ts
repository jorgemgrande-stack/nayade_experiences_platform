import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { capabilityStateFrom, navMode } from "@shared/adminNav";

// `readonly` (solo lectura) entra en el panel y ve lo mismo que el equipo, sin poder modificar nada
const PANEL_ROLES = ["admin", "agente", "monitor", "adminrest", "controler", "readonly"];

/**
 * Suscripción de la empresa en curso (plan, prueba y licencias) para el panel.
 * Una sola consulta compartida (caché de tRPC) entre el menú, el inicio y la página «Suscripción».
 */
export function usePanelSubscription() {
  const { user, isAuthenticated } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const query = trpc.subscription.overview.useQuery(undefined, {
    enabled: isAuthenticated && PANEL_ROLES.includes(role),
    staleTime: 120_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const mode = navMode({ data: query.data, isLoading: query.isLoading && query.fetchStatus !== "idle", isError: query.isError });
  const capabilityState = capabilityStateFrom(query.data);
  /** true si la capacidad está activa o en solo lectura (o si el panel no usa licencias por capacidad). */
  const can = (capabilityId: string) => mode !== "tasks" || capabilityState(capabilityId) !== null;
  /** true si la capacidad permite operar (crear/editar). */
  const canWrite = (capabilityId: string) => mode !== "tasks" || capabilityState(capabilityId) === "active";
  return { ...query, mode, capabilityState, can, canWrite, isLicensed: mode === "tasks" };
}
