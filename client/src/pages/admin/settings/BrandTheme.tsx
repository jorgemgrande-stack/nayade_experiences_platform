/**
 * Marca y tema (/admin/configuracion/marca): identidad de la empresa para su web y su pantalla de acceso, con vista
 * previa del acceso en escritorio y móvil. El editor es el mismo del paso «Marca» de Primeros pasos.
 */
import AdminLayout from "@/components/AdminLayout";
import { BrandIdentityEditor } from "@/components/brand/BrandIdentityEditor";
import { useI18n } from "@/i18n/I18nProvider";

export default function BrandTheme() {
  const { t } = useI18n();
  return (
    <AdminLayout>
      <div className="max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("settingsGeneral.brand.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("settingsGeneral.brand.intro")}
          </p>
        </div>
        <BrandIdentityEditor variant="full" />
      </div>
    </AdminLayout>
  );
}
