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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  UtensilsCrossed,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

const ROLES = [
  { value: "admin",     label: "Administrador",       color: "bg-red-100 text-red-800 border-red-200" },
  { value: "agente",    label: "Agente Comercial",     color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "monitor",   label: "Monitor",              color: "bg-green-100 text-green-800 border-green-200" },
  { value: "adminrest", label: "Gestor Restaurantes",  color: "bg-orange-100 text-orange-800 border-orange-200" },
  { value: "user",      label: "Usuario",              color: "bg-gray-100 text-gray-700 border-gray-200" },
] as const;

type Role = (typeof ROLES)[number]["value"];

function RoleBadge({ role }: { role: string }) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-700 border-gray-200">{role}</span>;
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

/** Panel de asignación de restaurantes para usuarios con rol adminrest */
function RestaurantAssignPanel({ userId, userName }: { userId: number; userName: string }) {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();

  const { data: allRestaurants = [] } = trpc.restaurants.adminGetAll.useQuery(undefined, { enabled: expanded });
  const { data: staffList = [], isLoading: loadingStaff } = trpc.restaurants.adminGetStaff.useQuery(
    // We need to get restaurants assigned to this user — we query each restaurant's staff
    // Instead we'll use myRestaurants approach: query all restaurants and filter by staff
    { restaurantId: 0 }, // placeholder — we'll handle this differently below
    { enabled: false }
  );

  // For each restaurant, check if this user is in the staff
  // We use a per-restaurant query approach via adminGetStaff
  const assignStaff = trpc.restaurants.adminAssignStaff.useMutation({
    onSuccess: () => {
      utils.restaurants.adminGetStaff.invalidate();
      toast.success("Restaurante asignado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const removeStaff = trpc.restaurants.adminRemoveStaff.useMutation({
    onSuccess: () => {
      utils.restaurants.adminGetStaff.invalidate();
      toast.success("Restaurante desasignado");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-700 font-medium transition-colors"
      >
        <UtensilsCrossed className="w-3 h-3" />
        Gestionar restaurantes asignados
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {expanded && (
        <RestaurantAssignList
          userId={userId}
          allRestaurants={allRestaurants}
          onAssign={(restaurantId) => assignStaff.mutate({ userId, restaurantId })}
          onRemove={(restaurantId) => removeStaff.mutate({ userId, restaurantId })}
          isPending={assignStaff.isPending || removeStaff.isPending}
        />
      )}
    </div>
  );
}

/** Lista de restaurantes con checkboxes de asignación */
function RestaurantAssignList({
  userId,
  allRestaurants,
  onAssign,
  onRemove,
  isPending,
}: {
  userId: number;
  allRestaurants: { id: number; name: string; slug: string }[];
  onAssign: (id: number) => void;
  onRemove: (id: number) => void;
  isPending: boolean;
}) {
  // Query staff for each restaurant to determine assignment
  const staffQueries = allRestaurants.map((r) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    trpc.restaurants.adminGetStaff.useQuery({ restaurantId: r.id })
  );

  if (allRestaurants.length === 0) {
    return <p className="text-xs text-gray-400 mt-2 ml-4">No hay restaurantes disponibles.</p>;
  }

  return (
    <div className="mt-2 ml-4 space-y-1.5 bg-orange-50 border border-orange-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-orange-700 mb-2">Restaurantes con acceso:</p>
      {allRestaurants.map((restaurant, idx) => {
        const staffData = staffQueries[idx]?.data ?? [];
        const isAssigned = staffData.some((s: any) => s.userId === userId);
        const isLoading = staffQueries[idx]?.isLoading;

        return (
          <div key={restaurant.id} className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-700 font-medium">{restaurant.name}</span>
            {isLoading ? (
              <span className="text-xs text-gray-400">...</span>
            ) : isAssigned ? (
              <button
                onClick={() => onRemove(restaurant.id)}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
              >
                <Minus className="w-3 h-3" />
                Quitar
              </button>
            ) : (
              <button
                onClick={() => onAssign(restaurant.id)}
                disabled={isPending}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                Asignar
              </button>
            )}
          </div>
        );
      })}
    </div>
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

  const purgeTestReservations = trpc.admin.purgeTestReservations.useMutation({
    onSuccess: (r) => toast.success("Reservas de prueba eliminadas", { description: `Registros borrados: ${r.deleted}` }),
    onError: (e) => toast.error("Error al purgar", { description: e.message }),
  });

  const setUserPassword = trpc.admin.setUserPassword.useMutation({
    onSuccess: () => {
      setPasswordTarget(null);
      setNewPassword("");
      toast.success("Contraseña actualizada", { description: "La contraseña ha sido cambiada correctamente." });
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
  const [passwordTarget, setPasswordTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const handleCreate = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Campos requeridos", { description: "Nombre y email son obligatorios." });
      return;
    }
    createUser.mutate({ ...form, role: form.role as any, origin: window.location.origin });
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
                      {/* Panel de asignación de restaurantes para adminrest */}
                      {user.role === "adminrest" && (
                        <RestaurantAssignPanel userId={user.id} userName={user.name ?? user.email ?? "Usuario"} />
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Select
                    value={user.role}
                    onValueChange={(value) =>
                      changeRole.mutate({ userId: user.id, role: value as any })
                    }
                  >
                    <SelectTrigger className="w-48 h-7 text-xs border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0">
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
                              role: user.role,
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
                        onClick={() => { setPasswordTarget({ id: user.id, name: user.name ?? user.email ?? "este usuario" }); setNewPassword(""); }}
                        className="gap-2"
                      >
                        <KeyRound className="w-4 h-4 text-violet-600" />
                        Cambiar contraseña
                      </DropdownMenuItem>
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
                      <div className="flex items-center gap-2">
                        <RoleBadge role={r.value} />
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.role === "adminrest" && (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-2 mt-1">
                  Este usuario solo tendrá acceso al gestor de reservas de restaurante. Podrás asignarle los restaurantes específicos después de crearlo.
                </p>
              )}
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

      {/* ── MANTENIMIENTO (bloque temporal — borrar tras usar) ──────── */}
      <div className="mt-8 rounded-xl border border-red-900/40 bg-red-950/10 p-4">
        <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Mantenimiento · Uso único</p>
        <p className="text-xs text-red-300/70 mb-3">
          Borra TODAS las reservas y datos operativos de la base de datos. Solo para limpieza de entorno de pruebas.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="border-red-700 text-red-400 hover:bg-red-500/10 text-xs">
              Purgar todas las reservas de prueba
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Borrar TODAS las reservas?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta acción eliminará permanentemente todas las reservas y datos operativos. No se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => purgeTestReservations.mutate()}
                disabled={purgeTestReservations.isPending}
              >
                {purgeTestReservations.isPending ? "Borrando..." : "Borrar todo"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Change Password Dialog */}
      <Dialog
        open={!!passwordTarget}
        onOpenChange={() => { setPasswordTarget(null); setNewPassword(""); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-violet-600" />
              Cambiar contraseña — {passwordTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="new-password">Nueva contraseña (mínimo 8 caracteres)</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setPasswordTarget(null); setNewPassword(""); }}
            >
              Cancelar
            </Button>
            <Button
              onClick={() =>
                passwordTarget &&
                setUserPassword.mutate({ userId: passwordTarget.id, password: newPassword })
              }
              disabled={newPassword.length < 8 || setUserPassword.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {setUserPassword.isPending ? "Guardando..." : "Guardar contraseña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
