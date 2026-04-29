import AdminLayout from "@/components/AdminLayout";
import ProposalsManager from "./ProposalsManager";

export default function ProposalsPage() {
  return (
    <AdminLayout title="Propuestas Comerciales">
      <ProposalsManager />
    </AdminLayout>
  );
}
