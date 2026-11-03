import { trpc } from "@/lib/trpc";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { siteOfStored } from "@shared/sites";

/**
 * Sedes de la empresa para los selectores y filtros del panel (capacidad Business `multi-site`).
 * `enabled` es false en Essential o con una sola sede activa: entonces no se muestra nada de sedes y todo es como hoy.
 */
export function useCompanySites() {
  const sub = usePanelSubscription();
  const licensed = sub.can("multi-site");
  const q = trpc.sites.list.useQuery(undefined, { enabled: licensed, staleTime: 60_000, retry: 1 });
  const all = q.data?.sites ?? [];
  const active = all.filter((s) => s.status === "active");
  const primarySiteId = q.data?.primarySiteId ?? "";
  const enabled = licensed && !!q.data?.multiSite && active.length > 1;
  /** Nombre de la sede de un dato del Core (NULL = principal). */
  const nameOf = (stored: string | null | undefined) => {
    const id = siteOfStored(stored, primarySiteId);
    return all.find((s) => s.siteId === id)?.name ?? id;
  };
  return { enabled, canWrite: enabled && sub.canWrite("multi-site"), sites: all, active, primarySiteId, nameOf };
}
