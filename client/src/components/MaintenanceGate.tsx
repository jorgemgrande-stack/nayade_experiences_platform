import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import MaintenanceNotice from "@/pages/MaintenanceNotice";

// Rutas que deben seguir funcionando durante el mantenimiento: el panel de
// admin completo y las páginas de login/recuperación necesarias para entrar en él.
const ALLOWED_PREFIXES = [
  "/admin",
  "/login",
  "/recuperar-contrasena",
  "/nueva-contrasena",
  "/establecer-contrasena",
];

export default function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data } = trpc.config.getPublicSettings.useQuery();

  const isAllowedRoute = ALLOWED_PREFIXES.some((p) => location.startsWith(p));
  const maintenanceOn = data?.site_maintenance_mode_enabled === "true";

  if (maintenanceOn && !isAllowedRoute) {
    return <MaintenanceNotice message={data?.site_maintenance_message} />;
  }

  return <>{children}</>;
}
