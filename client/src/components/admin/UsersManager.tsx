import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  UserPlus, MoreVertical, Shield, ShieldCheck, UserCheck, UserX,
  Trash2, Send, CheckCircle, Clock, XCircle, UtensilsCrossed,
  ChevronDown, ChevronUp, Plus, Minus, KeyRound, Eye, Star,
  Briefcase, MonitorPlay, Info, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

// ─── FASE 3: roleCapabilities — mapa estático de capacidades por rol (UI-only) ─
const roleCapabilities: Record<string, string[]> = {
  admin: [
    "Acceso completo al sistema",
    "Configuración y feature flags",
    "Gestión de usuarios y roles",
    "Contabilidad, gastos y REAV",
    "CMS, productos y categorías",
    "CRM, presupuestos y reservas",
    "TPV: operar y backoffice",
    "Hotel, SPA, restaurantes",
    "Proveedores y liquidaciones",
    "Anulaciones y ticketing",
  ],
  agente: [
    "CRM: leads, presupuestos, reservas",
    "Operaciones: calendario y actividades",
    "TPV: crear ventas y cerrar caja",
    "Cupones y ticketing",
    "Vista de códigos descuento",
  ],
  adminrest: [
    "Gestión reservas de restaurante",
    "Turnos y cierres del restaurante",
    "Calendario del restaurante",
    "Solo los restaurantes asignados",
  ],
  monitor: [
    "Calendario de operaciones (lectura)",
    "Actividades diarias (lectura)",
    "Sin acceso a datos financieros",
    "Sin acceso a CRM",
  ],
  user: [
    "Sin acceso al panel de administración",
    "Solo acceso al portal público",
  ],
};

// ─── ROLES — definición completa con colores, iconos y descripción ────────────
const ROLES = [
  {
    value: "admin",
    label: "Administrador",
    description: "Acceso total al sistema",
    color: "bg-red-100 text-red-800 border-red-200",
    dotColor: "bg-red-500",
    icon: ShieldCheck,
  },
  {
    value: "agente",
    label: "Agente Comercial",
    description: "CRM, reservas y TPV operativo",
    color: "bg-blue-100 text-blue-800 border-blue-200",
    dotColor: "bg-blue-500",
    icon: Briefcase,
  },
  {
    value: "monitor",
    label: "Monitor",
    description: "Calendario y actividades (lectura)",
    color: "bg-green-100 text-green-800 border-green-200",
    dotColor: "bg-green-500",
    icon: MonitorPlay,
  },
  {
    value: "adminrest",
    label: "Gestor Restaurantes",
    description: "Reservas del restaurante asignado",
    color: "bg-orange-100 text-orange-800 border-orange-200",
    dotColor: "bg-orange-500",
    icon: UtensilsCrossed,
  },
  {
    value: "user",
    label: "Usuario",
    description: "Sin acceso al panel admin",
    color: "bg-gray-100 text-gray-600 border-gray-200",
    dotColor: "bg-gray-400",
    icon: Eye,
  },
] as const;

type Role = (typeof ROLES)[number]["value"];

// ─── FASE 1: RoleBadge con icono por rol ──────────────────────────────────────
function RoleBadge({ role, isLastAdmin = false }: { role: string; isLastAdmin?: boolean }) {
  const r = ROLES.find((x) => x.value === role);
  if (!r) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-100 text-gray-700 border-gray-200">
        <Shield className="w-3 h-3" />
        {role}
      </span>
    );
  }
  const Icon = r.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${r.color}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {r.label}
      {isLastAdmin && (
        <span className="ml-0.5 text-[10px] font-bold text-red-700 bg-red-100 border border-red-300 rounded-full px-1">★</span>
      )}
    </span>
  );
}

// ─── FASE 1: RoleInfoCard — descripción + capacidades para el selector ────────
function RoleInfoCard({ roleValue }: { roleValue: string }) {
  const r = ROLES.find((x) => x.value === roleValue);
  if (!r) return null;
  const caps = roleCapabilities[roleValue] ?? [];
  const Icon = r.icon;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold border ${r.color}`}>
          <Icon className="w-3 h-3" />
          {r.label}
        </span>
        <span className="text-xs text-muted-foreground">{r.description}</span>
      </div>
      {caps.length > 0 && (
        <ul className="space-y-0.5">
          {caps.map((cap) => (
            <li key={cap} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <span className="mt-0.5 text-green-500">✓</span>
              {cap}
            </li>
          ))}
        </ul>
      )}
    </div>
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

// ─── Panel de asignación de restaurantes (sin cambios) ───────────────────────
function RestaurantAssignPanel({ userId, userName }: { userId: number; userName: string }) {
  const [expanded, setExpanded] = useState(false);
  const utils = trpc.useUtils();

  const { data: allRestaurants = [] } = trpc.restaurants.adminGetAll.useQuery(undefined, { enabled: expanded });

  const assignStaff = trpc.restaurants.adminAssignStaff.useMutation({
    onSuccess: () => { utils.restaurants.adminGetStaff.invalidate(); toast.success("Restaurante asignado"); },
    onError: (e) => toast.error("Error", { description: e.message }),
  });
  const removeStaff = trpc.restaurants.adminRemoveStaff.useMutation({
    onSuccess: () => { utils.restaurants.adminGetStaff.invalidate(); toast.success("Restaurante desasignado"); },
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
          onAssign={(id) => assignStaff.mutate({ userId, restaurantId: id })}
          onRemove={(id) => removeStaff.mutate({ userId, restaurantId: id })}
          isPending={assignStaff.isPending || removeStaff.isPending}
        />
      )}
    </div>
  );
}

function RestaurantAssignList({
  userId, allRestaurants, onAssign, onRemove, isPending,
}: {
  userId: number;
  allRestaurants: { id: number; name: string; slug: string }[];
  onAssign: (id: number) => void;
  onRemove: (id: number) => void;
  isPending: boolean;
}) {
  const staffQueries = allRestaurants.map((r) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    trpc.restaurants.adminGetStaff.useQuery({ restaurantId: r.id })
  );
  if (allRestaurants.length === 0) return <p className="text-xs text-gray-400 mt-2 ml-4">No hay restaurantes disponibles.</p>;
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
              <button onClick={() => onRemove(restaurant.id)} disabled={isPending}
                className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50">
                <Minus className="w-3 h-3" /> Quitar
              </button>
            ) : (
              <button onClick={() => onAssign(restaurant.id)} disabled={isPending}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium disabled:opacity-50">
                <Plus className="w-3 h-3" /> Asignar
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function UsersManager() {
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();

  const { data: users = [], isLoading } = trpc.admin.getUsers.useQuery();

  // ─── FASE 4: contadores y detección de último admin ───────────────────────
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of ROLES) counts[r.value] = 0;
    for (const u of users) counts[u.role] = (counts[u.role] ?? 0) + 1;
    return counts;
  }, [users]);

  const activeAdminCount = useMemo(
    () => users.filter((u) => u.role === "admin" && u.isActive).length,
    [users]
  );

  // ─── Mutations ──────────────────────────────────────────────────────────────
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
    onSuccess: () => { utils.admin.getUsers.invalidate(); toast.success("Rol actualizado"); },
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
    onSuccess: (r) => toast.success("Reservas eliminadas", { description: `Registros borrados: ${r.deleted}` }),
    onError: (e) => toast.error("Error al purgar", { description: e.message }),
  });

  const setUserPassword = trpc.admin.setUserPassword.useMutation({
    onSuccess: () => {
      setPasswordTarget(null);
      setNewPassword("");
      toast.success("Contraseña actualizada");
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

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "user" as Role });
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<{ id: number; name: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  // FASE 4: filtro por rol
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // ─── FASE 2: Guardia para cambio de rol ──────────────────────────────────
  function handleRoleChange(targetUserId: number, targetUserRole: string, newRole: string) {
    if (newRole === targetUserRole) return;

    // No permitir que el último admin pierda su rol
    if (targetUserRole === "admin" && newRole !== "admin" && activeAdminCount <= 1) {
      toast.error("Operación bloqueada", {
        description: "No puedes cambiar el rol del único administrador activo. Asigna primero otro administrador.",
      });
      return;
    }

    // No permitir que el propio usuario se quite permisos si es el último admin
    if (currentUser?.id === targetUserId && targetUserRole === "admin" && newRole !== "admin" && activeAdminCount <= 1) {
      toast.error("No puedes degradarte a ti mismo", {
        description: "Eres el único administrador activo. Asigna otro admin primero.",
      });
      return;
    }

    changeRole.mutate({ userId: targetUserId, role: newRole as any });
  }

  // ─── Filtered users ─────────────────────────────────────────────────────
  const filteredUsers = useMemo(
    () => (roleFilter === "all" ? users : users.filter((u) => u.role === roleFilter)),
    [users, roleFilter]
  );

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
    <TooltipProvider>
      <div className="space-y-6">

        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Gestión de Usuarios</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {users.length} usuario{users.length !== 1 ? "s" : ""} registrado{users.length !== 1 ? "s" : ""}
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)} className="bg-blue-700 hover:bg-blue-800 text-white gap-2">
            <UserPlus className="w-4 h-4" />
            Nuevo usuario
          </Button>
        </div>

        {/* ── FASE 4: Contadores por rol + último admin indicator ── */}
        <div className="flex flex-wrap gap-2">
          {ROLES.filter((r) => roleCounts[r.value] > 0).map((r) => {
            const Icon = r.icon;
            const isActive = roleFilter === r.value;
            return (
              <button
                key={r.value}
                onClick={() => setRoleFilter(isActive ? "all" : r.value)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  isActive
                    ? `${r.color} shadow-sm ring-2 ring-offset-1 ring-current`
                    : `${r.color} hover:shadow-sm opacity-80 hover:opacity-100`
                }`}
              >
                <Icon className="w-3 h-3" />
                {r.label}
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-white/60 font-bold text-[10px]">
                  {roleCounts[r.value]}
                </span>
              </button>
            );
          })}
          {roleFilter !== "all" && (
            <button
              onClick={() => setRoleFilter("all")}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 underline underline-offset-2"
            >
              Ver todos
            </button>
          )}
        </div>

        {/* ── FASE 4: Aviso si queda solo 1 admin ── */}
        {activeAdminCount === 1 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <span>
              Solo hay <strong>1 administrador activo</strong>. No podrás cambiar su rol hasta que haya al menos otro administrador.
            </span>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Usuario</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">
                  <div className="flex items-center gap-1">
                    Rol
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        <p className="text-xs">Haz clic en el rol para cambiarlo. El rol define qué partes del sistema son accesibles.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Estado</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Registrado</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredUsers.map((user) => {
                const isLastAdmin = user.role === "admin" && activeAdminCount <= 1;
                const isSelf = currentUser?.id === user.id;

                return (
                  <tr key={user.id} className={`hover:bg-gray-50 transition-colors ${!user.isActive ? "opacity-60" : ""}`}>
                    {/* Usuario */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 ${
                          user.role === "admin" ? "bg-gradient-to-br from-red-500 to-red-700"
                          : user.role === "agente" ? "bg-gradient-to-br from-blue-500 to-blue-700"
                          : user.role === "adminrest" ? "bg-gradient-to-br from-orange-500 to-orange-700"
                          : user.role === "monitor" ? "bg-gradient-to-br from-green-500 to-green-700"
                          : "bg-gradient-to-br from-gray-400 to-gray-600"
                        }`}>
                          {(user.name ?? user.email ?? "?").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5 font-medium text-gray-900">
                            {user.name ?? "—"}
                            {isSelf && (
                              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-1.5 py-0.5">
                                Tú
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 text-xs">{user.email ?? "—"}</div>
                          {user.role === "adminrest" && (
                            <RestaurantAssignPanel userId={user.id} userName={user.name ?? user.email ?? "Usuario"} />
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Rol — FASE 1: selector con descripción y capacidades */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Select
                          value={user.role}
                          onValueChange={(value) => handleRoleChange(user.id, user.role, value)}
                          disabled={isLastAdmin && isSelf}
                        >
                          <SelectTrigger className="w-auto h-7 text-xs border-0 bg-transparent p-0 focus:ring-0 focus:ring-offset-0 gap-1">
                            <SelectValue>
                              <RoleBadge role={user.role} isLastAdmin={isLastAdmin} />
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="w-80">
                            {ROLES.map((r) => (
                              <SelectItem
                                key={r.value}
                                value={r.value}
                                disabled={r.value !== "admin" && isLastAdmin && user.role === "admin"}
                              >
                                <div className="py-1 space-y-1 w-full">
                                  <div className="flex items-center gap-2">
                                    <RoleBadge role={r.value} />
                                    <span className="text-xs text-muted-foreground">{r.description}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1 pl-1">
                                    {(roleCapabilities[r.value] ?? []).slice(0, 3).map((cap) => (
                                      <span key={cap} className="text-[10px] text-gray-400">• {cap}</span>
                                    ))}
                                    {(roleCapabilities[r.value] ?? []).length > 3 && (
                                      <span className="text-[10px] text-gray-400">+{(roleCapabilities[r.value] ?? []).length - 3} más</span>
                                    )}
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Tooltip con capacidades completas */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button className="text-gray-300 hover:text-gray-500 transition-colors">
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-64 p-3">
                            <RoleInfoCard roleValue={user.role} />
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* FASE 2: advertencia de último admin */}
                      {isLastAdmin && (
                        <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                          <Star className="w-2.5 h-2.5" />
                          Único administrador activo
                        </p>
                      )}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      <StatusBadge inviteAccepted={Boolean(user.inviteAccepted)} isActive={Boolean(user.isActive)} />
                    </td>

                    {/* Fecha */}
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })
                        : "—"}
                    </td>

                    {/* Acciones */}
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
                              onClick={() => resendInvite.mutate({ userId: user.id, email: user.email ?? "", name: user.name ?? "", role: user.role, origin: window.location.origin })}
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
                            disabled={isLastAdmin}
                            className="gap-2"
                          >
                            {user.isActive ? (
                              <><UserX className="w-4 h-4 text-amber-600" />Desactivar usuario</>
                            ) : (
                              <><UserCheck className="w-4 h-4 text-green-600" />Activar usuario</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget({ id: user.id, name: user.name ?? user.email ?? "este usuario" })}
                            disabled={isSelf || isLastAdmin}
                            className="gap-2 text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                            Eliminar usuario
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                    {roleFilter !== "all"
                      ? `No hay usuarios con el rol "${ROLES.find((r) => r.value === roleFilter)?.label ?? roleFilter}".`
                      : "No hay usuarios registrados aún."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── Create User Dialog ── */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                Crear nuevo usuario
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-name">Nombre completo *</Label>
                <Input id="new-name" placeholder="Ej: María García" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-email">Email *</Label>
                <Input id="new-email" type="email" placeholder="maria@ejemplo.com" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-role">Rol</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}>
                  <SelectTrigger id="new-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-80">
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        <div className="py-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <RoleBadge role={r.value} />
                            <span className="text-xs text-muted-foreground">{r.description}</span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* FASE 1: Panel informativo del rol seleccionado */}
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  Accesos del rol seleccionado:
                </p>
                <ul className="space-y-0.5">
                  {(roleCapabilities[form.role] ?? []).map((cap) => (
                    <li key={cap} className="flex items-start gap-1.5 text-xs text-gray-600">
                      <span className="mt-0.5 text-green-500">✓</span>{cap}
                    </li>
                  ))}
                </ul>
              </div>

              {form.role === "adminrest" && (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg p-2">
                  Podrás asignar los restaurantes específicos después de crear el usuario.
                </p>
              )}
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
                Se enviará un email automático con un enlace para establecer contraseña. El enlace expira en 72 horas.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={createUser.isPending} className="bg-blue-700 hover:bg-blue-800 text-white">
                {createUser.isPending ? "Creando..." : "Crear y enviar invitación"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete Confirm ── */}
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

        {/* ── Change Password Dialog ── */}
        <Dialog open={!!passwordTarget} onOpenChange={() => { setPasswordTarget(null); setNewPassword(""); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-violet-600" />
                Cambiar contraseña — {passwordTarget?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Label htmlFor="new-password">Nueva contraseña (mínimo 8 caracteres)</Label>
              <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setPasswordTarget(null); setNewPassword(""); }}>Cancelar</Button>
              <Button
                onClick={() => passwordTarget && setUserPassword.mutate({ userId: passwordTarget.id, password: newPassword })}
                disabled={newPassword.length < 8 || setUserPassword.isPending}
                className="bg-violet-600 hover:bg-violet-700 text-white"
              >
                {setUserPassword.isPending ? "Guardando..." : "Guardar contraseña"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Mantenimiento ── */}
        <div className="mt-8 rounded-xl border border-red-900/40 bg-red-950/10 p-4">
          <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Mantenimiento · Uso único</p>
          <p className="text-xs text-red-300/70 mb-3">Borra TODAS las reservas y datos operativos. Solo para limpieza de entorno de pruebas.</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="border-red-700 text-red-400 hover:bg-red-500/10 text-xs">
                Purgar todas las reservas de prueba
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Borrar TODAS las reservas?</AlertDialogTitle>
                <AlertDialogDescription>Esta acción eliminará permanentemente todas las reservas y datos operativos. No se puede deshacer.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => purgeTestReservations.mutate()} disabled={purgeTestReservations.isPending}>
                  {purgeTestReservations.isPending ? "Borrando..." : "Borrar todo"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

      </div>
    </TooltipProvider>
  );
}
