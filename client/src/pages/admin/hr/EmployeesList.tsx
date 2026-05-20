/**
 * EmployeesList — Listado de empleados (Fase 10 RRHH).
 *
 * Consume hr.employees.list. El alta de empleados se hace aquí mismo
 * (modal "Nuevo empleado"); la edición completa, en la ficha del empleado.
 * El módulo es 100% autónomo — sin dependencia de la versión clásica.
 */
import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  Search, Users, UserCheck, UserX, Briefcase, Eye, Plus,
  Mail, Phone, Building2,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const INPUT_CLS = "bg-foreground/[0.05] border-foreground/[0.12] text-white mt-0.5";

export default function EmployeesList() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const { data: employees, isLoading } = trpc.hr.employees.list.useQuery({
    isActive: statusFilter === "all" ? undefined : statusFilter === "active",
    search: search || undefined,
  });

  // ── Alta de empleado ──
  const [createOpen, setCreateOpen] = useState(false);
  const [nFullName, setNFullName] = useState("");
  const [nDni, setNDni] = useState("");
  const [nEmail, setNEmail] = useState("");
  const [nPhone, setNPhone] = useState("");
  const [nPosition, setNPosition] = useState("");
  const [nDepartment, setNDepartment] = useState("");
  const [nContractType, setNContractType] = useState("temporal");

  const createEmployee = trpc.hr.employees.create.useMutation({
    onSuccess: (data) => {
      toast.success("Empleado creado");
      setCreateOpen(false);
      setNFullName(""); setNDni(""); setNEmail(""); setNPhone("");
      setNPosition(""); setNDepartment(""); setNContractType("temporal");
      utils.hr.employees.list.invalidate();
      navigate(`/admin/personal/empleados/${data.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Departamentos únicos para el filtro
  const departments = useMemo(() => {
    const set = new Set<string>();
    (employees ?? []).forEach(e => { if (e.department) set.add(e.department); });
    return Array.from(set).sort();
  }, [employees]);

  const filtered = useMemo(() => {
    if (departmentFilter === "all") return employees ?? [];
    return (employees ?? []).filter(e => e.department === departmentFilter);
  }, [employees, departmentFilter]);

  const counts = useMemo(() => {
    const list = employees ?? [];
    return {
      total: list.length,
      active: list.filter(e => e.isActive).length,
      inactive: list.filter(e => !e.isActive).length,
    };
  }, [employees]);

  return (
    <AdminLayout title="Empleados — Personal">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground flex items-center gap-2">
                <Users className="w-5 h-5 text-orange-400" />
                Empleados
              </h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5 hidden sm:block">
                Plantilla de Náyade Experiences — datos personales, contrato y documentos
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="bg-orange-600 hover:bg-orange-700 text-white">
              <Plus className="w-4 h-4 mr-1.5" />
              Nuevo empleado
            </Button>
          </div>

          {/* Mini-counters */}
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <UserCheck className="w-3.5 h-3.5" />
              <strong>{counts.active}</strong> activos
            </span>
            <span className="text-foreground/30">·</span>
            <span className="flex items-center gap-1.5 text-rose-400">
              <UserX className="w-3.5 h-3.5" />
              <strong>{counts.inactive}</strong> inactivos
            </span>
            <span className="text-foreground/30">·</span>
            <span className="flex items-center gap-1.5 text-foreground/60">
              <Users className="w-3.5 h-3.5" />
              <strong>{counts.total}</strong> total
            </span>
          </div>
        </div>

        {/* Filtros */}
        <div className="px-4 sm:px-6 py-3 border-b border-foreground/[0.05]">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input
                className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                placeholder="Buscar por nombre, email o teléfono…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="all" className="text-white">Todos los estados</SelectItem>
                <SelectItem value="active" className="text-white">Solo activos</SelectItem>
                <SelectItem value="inactive" className="text-white">Solo inactivos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="all" className="text-white">Todos los departamentos</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Lista */}
        <div className="px-4 sm:px-6 py-4">
          {isLoading && (
            <div className="text-center py-12 text-foreground/40 text-sm">Cargando empleados…</div>
          )}
          {!isLoading && filtered.length === 0 && (
            <div className="text-center py-12 text-foreground/40 text-sm">
              No se encontraron empleados con esos filtros.
            </div>
          )}
          {!isLoading && filtered.length > 0 && (
            <div className="rounded-xl border border-foreground/[0.08] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-[10px] uppercase tracking-widest text-foreground/50">
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3">Puesto / Depto</th>
                    <th className="px-4 py-3 hidden md:table-cell">Contacto</th>
                    <th className="px-4 py-3 hidden md:table-cell">Contrato</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.03] transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {e.photoUrl ? (
                            <img src={e.photoUrl} alt={e.fullName} className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-300 text-xs font-semibold">
                              {e.fullName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-foreground">{e.fullName}</div>
                            {e.dni && <div className="text-[10px] text-foreground/40">{e.dni}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground/80 text-xs flex items-center gap-1">
                            {e.position ? <><Briefcase className="w-3 h-3 text-foreground/40" />{e.position}</> : <span className="text-foreground/30">—</span>}
                          </span>
                          {e.department && (
                            <span className="text-foreground/50 text-[10px] flex items-center gap-1">
                              <Building2 className="w-3 h-3" />{e.department}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-col gap-0.5 text-xs text-foreground/70">
                          {e.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-foreground/40" />{e.email}</span>}
                          {e.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 text-foreground/40" />{e.phone}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-xs text-foreground/70">{e.contractType ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn(
                          "inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                          e.isActive
                            ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-300 border border-rose-500/30",
                        )}>
                          {e.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/personal/empleados/${e.id}`}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-300 hover:bg-orange-500/20 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          Ver
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: nuevo empleado */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-[#0d1526] border-foreground/[0.12] text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-orange-400" /> Nuevo empleado
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-xs text-foreground/50">
                Crea la ficha con los datos esenciales. El resto (contrato, documentos, acceso al portal)
                se completa después en la ficha del empleado.
              </p>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Nombre completo *</Label>
                <Input value={nFullName} onChange={e => setNFullName(e.target.value)} className={INPUT_CLS} placeholder="Nombre y apellidos" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">DNI / NIE</Label>
                  <Input value={nDni} onChange={e => setNDni(e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Teléfono</Label>
                  <Input value={nPhone} onChange={e => setNPhone(e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Email</Label>
                <Input type="email" value={nEmail} onChange={e => setNEmail(e.target.value)} className={INPUT_CLS}
                  placeholder="Necesario para dar acceso al portal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Puesto</Label>
                  <Input value={nPosition} onChange={e => setNPosition(e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Departamento</Label>
                  <Input value={nDepartment} onChange={e => setNDepartment(e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-[10px] uppercase tracking-wider">Tipo de contrato</Label>
                <Select value={nContractType} onValueChange={setNContractType}>
                  <SelectTrigger className={INPUT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                    {["indefinido", "temporal", "autonomo", "practicas", "otro"].map(t => (
                      <SelectItem key={t} value={t} className="text-white capitalize">{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => {
                  if (nFullName.trim().length < 2) { toast.error("Indica el nombre del empleado"); return; }
                  createEmployee.mutate({
                    fullName: nFullName.trim(),
                    dni: nDni || undefined,
                    email: nEmail || "",
                    phone: nPhone || undefined,
                    position: nPosition || undefined,
                    department: nDepartment || undefined,
                    contractType: nContractType as any,
                  });
                }}
                disabled={createEmployee.isPending}
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {createEmployee.isPending ? "Creando…" : "Crear empleado"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
