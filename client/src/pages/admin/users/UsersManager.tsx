import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search, Users, Shield, User, Briefcase } from "lucide-react";

const roleConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  admin: { label: "Admin", color: "bg-red-100 text-red-700", icon: <Shield className="w-3 h-3" /> },
  agente: { label: "Agente", color: "bg-blue-100 text-blue-700", icon: <Briefcase className="w-3 h-3" /> },
  monitor: { label: "Monitor", color: "bg-green-100 text-green-700", icon: <User className="w-3 h-3" /> },
  user: { label: "Usuario", color: "bg-gray-100 text-gray-700", icon: <User className="w-3 h-3" /> },
};

export default function UsersManager() {
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = trpc.admin.getUsers.useQuery();

  const filtered = users?.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <AdminLayout title="Usuarios">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Usuarios</h2>
          <p className="text-sm text-muted-foreground mt-1">{filtered.length} usuarios registrados</p>
        </div>
      </div>

      <div className="relative max-w-xs mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar usuario..." className="pl-9" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <p className="text-muted-foreground font-medium">No hay usuarios</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Usuario</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Email</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rol</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Último acceso</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((u) => {
                const role = roleConfig[u.role] ?? roleConfig.user;
                return (
                  <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                          {(u.name ?? "U").charAt(0).toUpperCase()}
                        </div>
                        <p className="font-medium text-foreground text-sm">{u.name ?? "Sin nombre"}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">{u.email ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${role.color}`}>
                        {role.icon} {role.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString("es-ES") : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("es-ES")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-sm text-amber-800 font-medium">Para cambiar el rol de un usuario, accede a la base de datos desde el panel de gestión y actualiza el campo <code className="bg-amber-100 px-1 rounded">role</code> en la tabla <code className="bg-amber-100 px-1 rounded">users</code>.</p>
      </div>
    </AdminLayout>
  );
}
