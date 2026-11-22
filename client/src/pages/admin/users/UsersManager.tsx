import AdminLayout from "@/components/AdminLayout";
import UsersManagerCore from "@/components/admin/UsersManager";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
import { useI18n } from "@/i18n/I18nProvider";

export default function UsersManager() {
  const { t } = useI18n();
  return (
    <AdminLayout title={t("usersAdmin.pageTitle")}>
      <UsersManagerCore />
      <WorkplaceLocks place="admin" className="px-4 sm:px-6 pb-6" />
    </AdminLayout>
  );
}
