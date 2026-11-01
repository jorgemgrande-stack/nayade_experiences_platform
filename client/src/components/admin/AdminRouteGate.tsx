/**
 * Guardián central de las rutas del panel (/admin/*), montado una sola vez en App.tsx.
 *
 *  - Empresa con licencias por capacidad que abre por URL algo no contratado: «No incluido en tu
 *    plan» con enlace para ampliar (misma resolución de capacidades que el menú, shared/adminNav).
 *  - Fallo al consultar la suscripción fuera del modo single: estado de error con «Reintentar»,
 *    nunca la pantalla de otra empresa.
 *  - Modo single, empresas sin licencias por capacidad, sin sesión o cargando: la página de siempre.
 *
 * Solo presentación: el servidor sigue autorizando cada operación (capabilityRouteGuard).
 */
import { lazy, Suspense, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { routeAccess, routeCapabilities } from "@shared/adminNav";

const AdminGateScreen = lazy(() => import("./AdminGateScreen"));

/** Rutas bajo /admin que no son pantallas del panel (enlaces de correo). */
const UNGUARDED = ["/admin/verificar-correo"];

export const isPanelPath = (path: string) =>
  (path === "/admin" || path.startsWith("/admin/")) && !UNGUARDED.some((p) => path === p || path.startsWith(p + "/"));

export default function AdminRouteGate({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  if (!isPanelPath(location)) return <>{children}</>;
  return <PanelGate location={location}>{children}</PanelGate>;
}

function PanelGate({ location, children }: { location: string; children: ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const sub = usePanelSubscription();
  // Sin sesión o comprobándola: la propia pantalla (su AdminLayout) lleva al inicio de sesión
  if (loading || !isAuthenticated) return <>{children}</>;
  const role = (user as { role?: string } | null)?.role ?? "user";
  let screen: "error" | "not_included" | null = null;
  if (sub.mode === "error") screen = "error";
  else if (sub.mode === "tasks" && routeAccess(location, sub.capabilityState, sub.extensionRoutes) === "not_included") screen = "not_included";
  if (!screen) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <AdminGateScreen kind={screen} error={sub.error} onRetry={sub.retry} canUpgrade={role === "admin"} capabilities={routeCapabilities(location, sub.extensionRoutes) ?? []} />
    </Suspense>
  );
}
