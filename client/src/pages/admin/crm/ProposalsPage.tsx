import AdminLayout from "@/components/AdminLayout";
import { useI18n } from "@/i18n/I18nProvider";
import ProposalsManager from "./ProposalsManager";

export default function ProposalsPage() {
  const { t } = useI18n();
  return (
    <AdminLayout title={t("crmProposals.pageTitle")}>
      <ProposalsManager />
    </AdminLayout>
  );
}
