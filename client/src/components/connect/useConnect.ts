/**
 * Elephant Connect en el panel: catálogo con estado (connect.catalog), intentos de compra con clave estable y
 * seguimiento de pedidos hasta que el backend los confirma.
 *
 * La activación se refleja SOLO cuando el backend la confirma (purchaseStatus = applied); entonces se vuelven a
 * pedir las licencias (subscription.overview) y el catálogo, y el menú muestra lo contratado sin cerrar sesión.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { withPendingOrders } from "@shared/connectMarketplace";
import {
  beginAttempt,
  browserAttemptStorage,
  loadAttempt,
  openOrders,
  phaseOf,
  pollDelayMs,
  recordResult,
  type PurchaseAttempt,
  type PurchaseStatus,
} from "@shared/connectPurchase";

const storage = browserAttemptStorage();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Ámbito de lo guardado: la persona (el navegador ya separa cada empresa por su dirección). */
function useScope(): string {
  const { user } = useAuth();
  return `u${(user as { id?: number } | null)?.id ?? "0"}`;
}

/** Re-render cuando cambia algún intento (en esta pestaña). */
function useAttemptsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((x) => x + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return v;
}

/** Catálogo de Elephant Connect con los pedidos propios en curso superpuestos (para no ofrecer comprar dos veces). */
export function useConnectCatalog() {
  const scope = useScope();
  const version = useAttemptsVersion();
  const query = trpc.connect.catalog.useQuery(undefined, { retry: 1, staleTime: 60_000 });
  const pending = useMemo(() => new Set(openOrders(storage, scope).map((a) => a.productKey)), [scope, version]);
  const items = useMemo(() => (query.data ? withPendingOrders(query.data.items, pending) : []), [query.data, pending]);
  return { ...query, items, pendingKeys: pending };
}

export type ConnectCatalogItem = ReturnType<typeof useConnectCatalog>["items"][number];

/** Invalida lo que depende de las licencias: menú (overview), catálogo de Connect y módulos. */
export function useRefreshLicences() {
  const utils = trpc.useUtils();
  return useCallback(() => {
    void utils.subscription.overview.invalidate();
    void utils.connect.catalog.invalidate();
    void utils.subscription.catalog.invalidate();
  }, [utils]);
}

/** Intento de compra de un producto: misma clave de idempotencia hasta un resultado definitivo del backend. */
export function useConnectAttempt(productKey: string) {
  const scope = useScope();
  useAttemptsVersion();
  const current = loadAttempt(storage, scope, productKey, Date.now());
  const begin = useCallback(() => {
    const a = beginAttempt(storage, scope, productKey, Date.now());
    notify();
    return a;
  }, [scope, productKey]);
  const record = useCallback(
    (a: PurchaseAttempt, r: { status: PurchaseStatus; orderId?: number | null; paymentUrl?: string | null }) => {
      const next = recordResult(storage, scope, a, r);
      notify();
      return next;
    },
    [scope],
  );
  return { attempt: current, begin, record };
}

/**
 * Sigue un pedido aceptado consultando su estado al backend hasta que se aplica, falla o caduca. Al aplicarse,
 * refresca licencias y catálogo. Volver de la página de pago no confirma nada: solo esta consulta.
 */
export function useOrderTracking(attempt: PurchaseAttempt | null, onSettled?: (status: PurchaseStatus) => void) {
  const scope = useScope();
  const refresh = useRefreshLicences();
  const [tries, setTries] = useState(0);
  const orderId = attempt?.orderId ?? null;
  const waiting = !!attempt && orderId !== null && attempt.status !== "draft" && phaseOf(attempt.status) === "waiting";
  const q = trpc.subscription.purchaseStatus.useQuery(
    { orderId: orderId ?? 1 },
    { enabled: waiting, retry: 2, refetchOnWindowFocus: true, refetchInterval: () => (waiting ? pollDelayMs(attempt!.status as PurchaseStatus, tries) : false) },
  );
  const data = q.data as { status: PurchaseStatus; orderId: number; paymentUrl: string | null } | undefined;
  useEffect(() => {
    if (!data || !attempt || !waiting || data.orderId !== orderId) return;
    setTries((t) => t + 1);
    recordResult(storage, scope, attempt, data);
    notify();
    if (phaseOf(data.status) !== "waiting") {
      if (data.status === "applied") refresh();
      onSettled?.(data.status);
    }
    // Solo reacciona a una respuesta nueva del backend
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.dataUpdatedAt]);
  return { status: data?.status ?? (attempt?.status === "draft" ? null : (attempt?.status ?? null)), isChecking: q.isFetching, error: q.error, recheck: () => q.refetch() };
}

/** Todos los pedidos propios en curso (para retomarlos al abrir la página, p. ej. al volver del pago). */
export function useOpenOrders(): PurchaseAttempt[] {
  const scope = useScope();
  const version = useAttemptsVersion();
  return useMemo(() => openOrders(storage, scope), [scope, version]);
}
