import AdminLayout from "@/components/AdminLayout";
import UsersManagerCore from "@/components/admin/UsersManager";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";

export default function UsersManager() {
  return (
    <AdminLayout title="Usuarios">
      <UsersManagerCore />
      <WorkplaceLocks place="admin" className="px-4 sm:px-6 pb-6" />
    </AdminLayout>
  );
}
