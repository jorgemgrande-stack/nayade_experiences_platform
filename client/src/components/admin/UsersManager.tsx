import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UserPlus,
  MoreVertical,
  Shield,
  UserCheck,
  UserX,
  Trash2,
  Send,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const ROLES = [
  { value: "admin", label: "Administrador", color: "bg-red-100 text-red-800 border-red-200" },
  { value: "agente", label: "Agente Comercial", color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "monitor", label: "Monitor", color: "bg-green-100 text-green-800 border-green-200" },
  { value: "user", label: "Usuario", color: "bg-gray-100 text-gray-700 border-gray-200" },
] as const;

type Role = (typeof ROLES)[number]["value"];

function RoleBadge({ role }: { role: string }) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) return <Badge variant="outline">{role}</Badge>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${r.color}`}>
      <Shield className="w-3 h-3" />
      {r.label}
    </span>
  );
}

function StatusBadge({ inviteAccepted, isActive }: { inviteAccepted: boolean; isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
        <XCircle className="w-3 h-3" /> Desactivado
      </span>
    );
  }
  if (inviteAccepted) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
        <CheckCircle className="w-3 h-3" /> Activo
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
      <Clock className="w-3 h-3" /> Invitación pendiente
    </span>
  );
}

export default function UsersManager() {
  const utils = trpc.useUtils();

  // Data
  const { data: users = [], isLoading } = trpc.admin.getUsers.useQuery();

  // Mutations
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      setShowCreate(false);
      setForm({ name: "", email: "", role: "user" });
      toast.success("Usuario creado", { description: "Se ha enviado el email de invitación." });
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const changeRole = trpc.admin.changeUserRole.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      toast.success("Rol actualizado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const toggleActive = trpc.admin.toggleUserActive.useMutation({
    onSuccess: (data) => {
      utils.admin.getUsers.invalidate();
      toast.success(data.isActive ? "Usuario activado" : "Usuario desactivado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const resendInvite = trpc.admin.resendInvite.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      toast.success("Invitación reenviada", { description: "Se ha enviado un nuevo enlace por email." });
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      utils.admin.getUsers.invalidate();
      setDeleteTarget(null);
      toast.success("Usuario eliminado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  // UI state
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "user" as Role });
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const handleCreate = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Campos requeridos", { description: "Nombre y email son obligatorios." });
      return;
    }
    createUser.mutate({ ...form, origin: window.location.origin });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Gestión de Usuarios</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {users.length} usuario{users.length !== 1 ? "s" : ""} registrado{users.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="bg-blue-700 hover:bg-blue-800 text-white gap-2"
        >
          <UserPlus className="w-4 h-4" />
          Nuevo usuario
        </Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Usuario</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Rol</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600">Registrado</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-600">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                      {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{user.name ?? "—"}</div>
                      <div className="text-gray-500 text-xs">{user.email ?? "—"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={user.role}
                    onValueChange={(value) =>
                      changeRole.mutate({ userId: user.id, role: value as Role })
                    }
                  >
                    <SelectTrigger className="w-44 h-7 text-xs border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0">
                      <SelectValue>
                        <RoleBadge role={user.role} />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <RoleBadge role={r.value} />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    inviteAccepted={Boolean(user.inviteAccepted)}
                    isActive={Boolean(user.isActive)}
                  />
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleDateString("es-ES", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {!user.inviteAccepted && (
                        <DropdownMenuItem
                          onClick={() =>
                            resendInvite.mutate({
                              userId: user.id,
                              email: user.email ?? "",
                              name: user.name ?? "",
                              origin: window.location.origin,
                            })
                          }
                          className="gap-2"
                        >
                          <Send className="w-4 h-4 text-blue-600" />
                          Reenviar invitación
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={() => toggleActive.mutate({ userId: user.id })}
                        className="gap-2"
                      >
                        {user.isActive ? (
                          <>
                            <UserX className="w-4 h-4 text-amber-600" />
                            Desactivar usuario
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4 text-green-600" />
                            Activar usuario
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget({ id: user.id, name: user.name ?? user.email ?? "este usuario" })}
                        className="gap-2 text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar usuario
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                  No hay usuarios registrados aún.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-blue-600" />
              Crear nuevo usuario
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">Nombre completo *</Label>
              <Input
                id="new-name"
                placeholder="Ej: María García"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email *</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="maria@ejemplo.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Rol</Label>
              <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}>
                <SelectTrigger id="new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
              Se enviará un email automático a la dirección indicada con un enlace para que el usuario establezca su contraseña. El enlace expira en 72 horas.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={createUser.isPending}
              className="bg-blue-700 hover:bg-blue-800 text-white"
            >
              {createUser.isPending ? "Creando..." : "Crear y enviar invitación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará permanentemente a <strong>{deleteTarget?.name}</strong> y todos sus datos. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => deleteTarget && deleteUser.mutate({ userId: deleteTarget.id })}
            >
              Eliminar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
