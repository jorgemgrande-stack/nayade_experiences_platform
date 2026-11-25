import AdminLayout from "@/components/AdminLayout";
import ProposalsManager from "./ProposalsManager";

// El nombre de la pantalla («Propuestas comerciales») lo da el h1 del propio listado: sin título duplicado en la barra superior.
export default function ProposalsPage() {
  return (
    <AdminLayout>
      <ProposalsManager />
    </AdminLayout>
  );
}
