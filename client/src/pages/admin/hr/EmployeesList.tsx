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
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const INPUT_CLS = "bg-foreground/[0.05] border-foreground/[0.12] text-foreground mt-0.5";

export default function EmployeesList() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");

  const { data: employees, isLoading, error, refetch } = trpc.hr.employees.list.useQuery({
    isActive: statusFilter === "all" ? undefined : statusFilter === "active",
    search: search || undefined,
  });
  // Sin ninguna ficha todavía (sin filtros que valgan): estado vacío con el alta del primero
  const { data: employeeCounters } = trpc.hr.employees.counters.useQuery();
  const noEmployeesYet = employeeCounters?.total === 0;

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
      utils.hr.onboarding.status.invalidate();
      utils.hr.employees.counters.invalidate();
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
      <div className="min-h-screen bg-background text-foreground">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6">
          <PanelPageHeader
            icon={<Users />}
            title="Empleados"
            description="Plantilla de la empresa — datos personales, contrato y documentos"
            actions={
              <>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Nuevo empleado
                </Button>
              </>
            }
          />

          {/* Mini-counters */}
          <div className="flex items-center gap-3 mt-3 text-xs">
            <span className="flex items-center gap-1.5 text-success">
              <UserCheck className="w-3.5 h-3.5" />
              <strong>{counts.active}</strong> activos
            </span>
            <span className="text-foreground/30">·</span>
            <span className="flex items-center gap-1.5 text-danger">
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
                className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-foreground text-sm"
                placeholder="Buscar por nombre, email o teléfono…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-foreground/[0.12]">
                <SelectItem value="all" className="text-foreground">Todos los estados</SelectItem>
                <SelectItem value="active" className="text-foreground">Solo activos</SelectItem>
                <SelectItem value="inactive" className="text-foreground">Solo inactivos</SelectItem>
              </SelectContent>
            </Select>
            <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-card border-foreground/[0.12]">
                <SelectItem value="all" className="text-foreground">Todos los departamentos</SelectItem>
                {departments.map(d => (
                  <SelectItem key={d} value={d} className="text-foreground">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Lista */}
        <div className="px-4 sm:px-6 py-4">
          {!isLoading && error && <PanelError error={error} onRetry={() => refetch()} />}
          {isLoading && (
            <PanelLoading label="Cargando empleados…" />
          )}
          {!isLoading && !error && filtered.length === 0 && !noEmployeesYet && (
            <PanelEmpty title="No se encontraron empleados con esos filtros." />
          )}
          {!isLoading && !error && filtered.length === 0 && noEmployeesYet && (
            <div className="text-center py-12 space-y-3">
              <p className="text-sm text-foreground/60">Todavía no hay empleados. Da de alta al primero para empezar a llevar fichajes, vacaciones y nóminas.</p>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1.5" />
                Dar de alta el primer empleado
              </Button>
            </div>
          )}
          {!isLoading && !error && filtered.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                  <tr className="text-left text-xs uppercase tracking-widest text-foreground/50">
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
                            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-semibold">
                              {e.fullName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium text-foreground">{e.fullName}</div>
                            {e.dni && <div className="text-xs text-foreground/40">{e.dni}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-foreground/80 text-xs flex items-center gap-1">
                            {e.position ? <><Briefcase className="w-3 h-3 text-foreground/40" />{e.position}</> : <span className="text-foreground/30">—</span>}
                          </span>
                          {e.department && (
                            <span className="text-foreground/50 text-xs flex items-center gap-1">
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
                          "inline-block px-2 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
                          e.isActive
                            ? "bg-success/15 text-success border border-success/30"
                            : "bg-danger/15 text-danger border border-danger/30",
                        )}>
                          {e.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/personal/empleados/${e.id}`}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
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
          <DialogContent className="bg-card border-foreground/[0.12] text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" /> Nuevo empleado
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <p className="text-xs text-foreground/50">
                Crea la ficha con los datos esenciales. El resto (contrato, documentos, acceso al portal)
                se completa después en la ficha del empleado.
              </p>
              <div>
                <Label className="text-foreground/50 text-xs uppercase tracking-wider">Nombre completo *</Label>
                <Input value={nFullName} onChange={e => setNFullName(e.target.value)} className={INPUT_CLS} placeholder="Nombre y apellidos" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">DNI / NIE</Label>
                  <Input value={nDni} onChange={e => setNDni(e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Teléfono</Label>
                  <Input value={nPhone} onChange={e => setNPhone(e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-xs uppercase tracking-wider">Email</Label>
                <Input type="email" value={nEmail} onChange={e => setNEmail(e.target.value)} className={INPUT_CLS}
                  placeholder="Necesario para dar acceso al portal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Puesto</Label>
                  <Input value={nPosition} onChange={e => setNPosition(e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label className="text-foreground/50 text-xs uppercase tracking-wider">Departamento</Label>
                  <Input value={nDepartment} onChange={e => setNDepartment(e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
              <div>
                <Label className="text-foreground/50 text-xs uppercase tracking-wider">Tipo de contrato</Label>
                <Select value={nContractType} onValueChange={setNContractType}>
                  <SelectTrigger className={INPUT_CLS}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-foreground/[0.12]">
                    {["indefinido", "temporal", "autonomo", "practicas", "otro"].map(t => (
                      <SelectItem key={t} value={t} className="text-foreground capitalize">{t}</SelectItem>
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
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
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
