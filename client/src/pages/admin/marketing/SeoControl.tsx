/**
 * Elephant Connect · SEO Control (/admin/marketing/seo): seguimiento SEO de la web de la empresa. Palabras clave con su
 * URL objetivo y sus posiciones (importadas de su Google Search Console o anotadas a mano), rendimiento por consulta y
 * página, auditoría on-page de sus páginas públicas, reseñas (propias de la web, Google Business Profile y
 * TripAdvisor) y un panel con evolución y alertas simples. Los conectores usan las credenciales de la empresa
 * (Integraciones): sin configurar, están desactivados. La autorización real (licencia `seo-control` y administración)
 * la aplica el servidor. Las pestañas están en SeoControlParts.tsx.
 */
import { useState } from "react";
import { Search } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { tabFromUrl } from "@/lib/tabFromUrl";
import { useI18n } from "@/i18n/I18nProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { Audit, Dashboard, Keywords, Reviews, SearchConsole } from "./SeoControlParts";

const TAB_OF: Record<string, string> = { keywords: "palabras", audit: "auditoria", reviews: "resenas" };

export default function SeoControl() {
  const { t } = useI18n();
  const [tab, setTab] = useState<string>(() => tabFromUrl(["panel", "palabras", "gsc", "auditoria", "resenas"], "panel"));
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <PanelPageHeader icon={<Search />} title={t("seoControl.title")} description={t("seoControl.description")} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="panel">{t("seoControl.tabs.panel")}</TabsTrigger>
            <TabsTrigger value="palabras">{t("seoControl.tabs.keywords")}</TabsTrigger>
            <TabsTrigger value="gsc">{t("seoControl.tabs.gsc")}</TabsTrigger>
            <TabsTrigger value="auditoria">{t("seoControl.tabs.audit")}</TabsTrigger>
            <TabsTrigger value="resenas">{t("seoControl.tabs.reviews")}</TabsTrigger>
          </TabsList>
          <TabsContent value="panel" className="pt-4"><Dashboard goTo={(x) => setTab(TAB_OF[x] ?? x)} /></TabsContent>
          <TabsContent value="palabras" className="pt-4"><Keywords /></TabsContent>
          <TabsContent value="gsc" className="pt-4"><SearchConsole /></TabsContent>
          <TabsContent value="auditoria" className="pt-4"><Audit /></TabsContent>
          <TabsContent value="resenas" className="pt-4"><Reviews /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
