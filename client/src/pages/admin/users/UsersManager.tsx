import AdminLayout from "@/components/AdminLayout";
import UsersManagerCore from "@/components/admin/UsersManager";

export default function UsersManager() {
  return (
    <AdminLayout title="Usuarios">
      <UsersManagerCore />
    </AdminLayout>
  );
}
