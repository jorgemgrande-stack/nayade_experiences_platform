/** Pantallas del guardián de rutas del panel (carga diferida: no pesan en la web pública). */
import AdminLayout from "@/components/AdminLayout";
import { PanelError, PanelNotIncluded } from "@/components/admin/PanelStates";
import { AMPLIAR_PATH, fichaPath, productForCapability } from "@/components/connect/LockedFeature";
import { useConnectCatalog } from "@/components/connect/useConnect";
import { useI18n } from "@/i18n/I18nProvider";

/** Ficha de Elephant Connect del primer producto que concede alguna capacidad de la ruta; si no hay, «Amplía tu empresa». */
function NotIncluded({ canUpgrade, capabilities }: { canUpgrade: boolean; capabilities: string[] }) {
  const { items } = useConnectCatalog();
  const product = capabilities.map((c) => productForCapability(items, c)).find((p) => p !== null) ?? null;
  return <PanelNotIncluded canUpgrade={canUpgrade} href={product ? fichaPath(product.key) : AMPLIAR_PATH} />;
}

export default function AdminGateScreen({
  kind,
  error,
  onRetry,
  canUpgrade,
  capabilities,
}: {
  kind: "error" | "not_included";
  error?: unknown;
  onRetry: () => void;
  canUpgrade: boolean;
  capabilities: string[];
}) {
  const { t } = useI18n();
  if (kind === "error") {
    return (
      <AdminLayout title={t("help.gate.panel")}>
        <PanelError title={t("help.gate.loadError")} error={error} onRetry={onRetry} />
      </AdminLayout>
    );
  }
  return (
    <AdminLayout title={t("help.gate.notIncluded")}>
      <NotIncluded canUpgrade={canUpgrade} capabilities={capabilities} />
    </AdminLayout>
  );
}
