import AdminLayout from "@/components/AdminLayout";
import ProposalsManager from "./ProposalsManager";

export default function ProposalsPage() {
  return (
    <AdminLayout>
      <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-8 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Propuestas Comerciales</h1>
          <p className="text-foreground/50 text-sm mt-1">
            Propuestas pre-presupuesto enviadas a clientes. Configurable o multi-opción.
          </p>
        </div>
        <ProposalsManager />
      </div>
    </AdminLayout>
  );
}
