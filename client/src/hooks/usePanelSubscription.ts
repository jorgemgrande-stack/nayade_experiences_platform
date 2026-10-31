import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { capabilityStateFrom, installModeFrom, navMode } from "@shared/adminNav";

// `readonly` (solo lectura) entra en el panel y ve lo mismo que el equipo, sin poder modificar nada
const PANEL_ROLES = ["admin", "agente", "monitor", "adminrest", "controler", "readonly"];

/**
 * Suscripción de la empresa en curso (plan, prueba y licencias) para el panel.
 * Una sola consulta compartida (caché de tRPC) entre el menú, el inicio y la página «Suscripción».
 *
 * El menú de siempre (modo «legacy») solo se usa en la instalación de una sola empresa o cuando el
 * servidor lo indica; un fallo al consultar la suscripción da `mode = "error"` (con `retry`), nunca
 * el menú ni los permisos de otra empresa.
 */
export function usePanelSubscription() {
  const { user, isAuthenticated } = useAuth();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const query = trpc.subscription.overview.useQuery(undefined, {
    enabled: isAuthenticated && PANEL_ROLES.includes(role),
    staleTime: 120_000,
    retry: 1,
    // Con error no se reintenta al montar cada pantalla (el guardián y el menú montan otra): solo con «Reintentar»
    retryOnMount: false,
    // Una suspensión o una contratación se ve en el menú sin navegar (las licencias del servidor caducan a los 30 s)
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  // Mismos ajustes públicos (y misma caché) que el menú: traen el modo de instalación
  const publicSettings = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const install = installModeFrom(publicSettings.data);
  const mode = navMode({ data: query.data, isLoading: query.isLoading && query.fetchStatus !== "idle", isError: query.isError, install });
  const capabilityState = capabilityStateFrom(query.data);
  /** true si la capacidad está activa o en solo lectura (todo en el menú de siempre; nada mientras carga o con error). */
  const can = (capabilityId: string) => mode === "legacy" || (mode === "tasks" && capabilityState(capabilityId) !== null);
  /** true si la capacidad permite operar (crear/editar). */
  const canWrite = (capabilityId: string) => mode === "legacy" || (mode === "tasks" && capabilityState(capabilityId) === "active");
  /** Vuelve a consultar la suscripción (y el modo de instalación si faltaba). */
  const retry = () => {
    void query.refetch();
    if (!install) void publicSettings.refetch();
  };
  return { ...query, mode, install, capabilityState, can, canWrite, retry, isLicensed: mode === "tasks" };
}
