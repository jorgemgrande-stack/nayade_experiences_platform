/**
 * Marca y tema (/admin/configuracion/marca): identidad de la empresa para su web y su pantalla de acceso, con vista
 * previa del acceso en escritorio y móvil. El editor es el mismo del paso «Marca» de Primeros pasos.
 */
import AdminLayout from "@/components/AdminLayout";
import { BrandIdentityEditor } from "@/components/brand/BrandIdentityEditor";

export default function BrandTheme() {
  return (
    <AdminLayout>
      <div className="max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Marca y tema</h1>
          <p className="text-sm text-muted-foreground">
            Tu logotipo, tus colores y tus imágenes. Se aplican a la vez en tu web y en la pantalla de acceso de tu equipo.
          </p>
        </div>
        <BrandIdentityEditor variant="full" />
      </div>
    </AdminLayout>
  );
}
