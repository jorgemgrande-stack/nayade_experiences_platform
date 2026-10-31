/** Pantallas del guardián de rutas del panel (carga diferida: no pesan en la web pública). */
import AdminLayout from "@/components/AdminLayout";
import { PanelError, PanelNotIncluded } from "@/components/admin/PanelStates";

export default function AdminGateScreen({
  kind,
  error,
  onRetry,
  canUpgrade,
}: {
  kind: "error" | "not_included";
  error?: unknown;
  onRetry: () => void;
  canUpgrade: boolean;
}) {
  if (kind === "error") {
    return (
      <AdminLayout title="Panel">
        <PanelError title="No se ha podido cargar tu panel" error={error} onRetry={onRetry} />
      </AdminLayout>
    );
  }
  return (
    <AdminLayout title="No incluido en tu plan">
      <PanelNotIncluded canUpgrade={canUpgrade} />
    </AdminLayout>
  );
}
