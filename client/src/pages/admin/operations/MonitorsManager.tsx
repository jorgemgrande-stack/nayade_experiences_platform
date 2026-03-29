import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import {
  UserCheck, Plus, Search, Phone, Mail, FileText, Euro,
  ChevronDown, ChevronUp, Edit3, Trash2, Save, X,
  AlertCircle, CheckCircle2, RefreshCw, Download,
  CreditCard, Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const CONTRACT_OPTIONS = [
  { value: "indefinido", label: "Indefinido" },
  { value: "temporal", label: "Temporal" },
  { value: "autonomo", label: "Autónomo" },
  { value: "practicas", label: "Prácticas" },
  { value: "otro", label: "Otro" },
] as const;

const MONTHS = [
  "Enero","Febrero","Marzo","Abril","Mayo","Junio",
  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
];

function formatCurrency(n: number | string) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n));
}
function formatDate(ts: number | Date | null | undefined) {
  if (!ts) return "—";
  return new Date(ts as any).toLocaleDateString("es-ES");
}

const EMPTY_FORM = {
  fullName: "", dni: "", email: "", phone: "", address: "",
  birthDate: "", emergencyName: "", emergencyRelation: "", emergencyPhone: "",
  iban: "", ibanHolder: "",
  contractType: "temporal" as "indefinido"|"temporal"|"autonomo"|"practicas"|"otro",
  contractStart: "", contractEnd: "", contractConditions: "",
  notes: "", isActive: true,
};

const EMPTY_PAYROLL = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  baseSalary: "",
  totalAmount: "",
  notes: "",
};

export default function MonitorsManager() {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"info"|"payroll"|"docs">("info");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPayrollModal, setShowPayrollModal] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState<any>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [payrollForm, setPayrollForm] = useState({ ...EMPTY_PAYROLL });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: monitorsData, isLoading, refetch } = trpc.operations.monitors.list.useQuery(
    { search: search || undefined },
    { refetchOnWindowFocus: false }
  );

  const { data: selectedMonitor, refetch: refetchMonitor } = trpc.operations.monitors.get.useQuery(
    { id: expandedId! },
    { enabled: !!expandedId, refetchOnWindowFocus: false }
  );

  const createMutation = trpc.operations.monitors.create.useMutation({
    onSuccess: () => {
      toast.success("Monitor creado correctamente");
      setShowCreateModal(false);
      setForm({ ...EMPTY_FORM });
      refetch();
    },
    onError: (e) => toast.error("Error al crear monitor: " + e.message),
  });

  const updateMutation = trpc.operations.monitors.update.useMutation({
    onSuccess: () => {
      toast.success("Monitor actualizado");
      setShowEditModal(false);
      refetch();
      refetchMonitor();
    },
    onError: (e) => toast.error("Error al actualizar: " + e.message),
  });

  const deleteMutation = trpc.operations.monitors.delete.useMutation({
    onSuccess: () => {
      toast.success("Monitor eliminado");
      setConfirmDeleteId(null);
      if (expandedId === confirmDeleteId) setExpandedId(null);
      refetch();
    },
    onError: () => toast.error("Error al eliminar"),
  });

  const addPayrollMutation = trpc.operations.monitors.addPayroll.useMutation({
    onSuccess: () => {
      toast.success("Nómina añadida correctamente");
      setShowPayrollModal(false);
      setPayrollForm({ ...EMPTY_PAYROLL });
      refetchMonitor();
    },
    onError: (e) => toast.error("Error al añadir nómina: " + e.message),
  });

  const monitors = (monitorsData as any[]) || [];
  const activeMonitors = monitors.filter((m) => m.isActive);
  const inactiveMonitors = monitors.filter((m) => !m.isActive);

  function openEdit(monitor: any) {
    setEditingMonitor(monitor);
    setForm({
      fullName: monitor.fullName || "",
      dni: monitor.dni || "",
      email: monitor.email || "",
      phone: monitor.phone || "",
      address: monitor.address || "",
      birthDate: monitor.birthDate ? new Date(monitor.birthDate).toISOString().split("T")[0] : "",
      emergencyName: monitor.emergencyName || "",
      emergencyRelation: monitor.emergencyRelation || "",
      emergencyPhone: monitor.emergencyPhone || "",
      iban: monitor.iban || "",
      ibanHolder: monitor.ibanHolder || "",
      contractType: monitor.contractType || "temporal",
      contractStart: monitor.contractStart ? new Date(monitor.contractStart).toISOString().split("T")[0] : "",
      contractEnd: monitor.contractEnd ? new Date(monitor.contractEnd).toISOString().split("T")[0] : "",
      contractConditions: monitor.contractConditions || "",
      notes: monitor.notes || "",
      isActive: monitor.isActive ?? true,
    });
    setShowEditModal(true);
  }

  function handleCreate() {
    createMutation.mutate({
      fullName: form.fullName,
      dni: form.dni || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      birthDate: form.birthDate || undefined,
      emergencyName: form.emergencyName || undefined,
      emergencyRelation: form.emergencyRelation || undefined,
      emergencyPhone: form.emergencyPhone || undefined,
      iban: form.iban || undefined,
      ibanHolder: form.ibanHolder || undefined,
      contractType: form.contractType,
      contractStart: form.contractStart || undefined,
      contractEnd: form.contractEnd || undefined,
      contractConditions: form.contractConditions || undefined,
      notes: form.notes || undefined,
    });
  }

  function handleUpdate() {
    if (!editingMonitor) return;
    updateMutation.mutate({
      id: editingMonitor.id,
      fullName: form.fullName,
      dni: form.dni || undefined,
      email: form.email || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      birthDate: form.birthDate || undefined,
      emergencyName: form.emergencyName || undefined,
      emergencyRelation: form.emergencyRelation || undefined,
      emergencyPhone: form.emergencyPhone || undefined,
      iban: form.iban || undefined,
      ibanHolder: form.ibanHolder || undefined,
      contractType: form.contractType,
      contractStart: form.contractStart || undefined,
      contractEnd: form.contractEnd || undefined,
      contractConditions: form.contractConditions || undefined,
      notes: form.notes || undefined,
      isActive: form.isActive,
    });
  }

  function handleAddPayroll() {
    if (!expandedId) return;
    const total = payrollForm.totalAmount || payrollForm.baseSalary;
    addPayrollMutation.mutate({
      monitorId: expandedId,
      year: payrollForm.year,
      month: payrollForm.month,
      baseSalary: payrollForm.baseSalary,
      extras: [],
      totalAmount: total,
      notes: payrollForm.notes || undefined,
    });
  }

  const payrolls = (selectedMonitor as any)?.payrolls || [];
  const docs = (selectedMonitor as any)?.documents || [];

  return (
    <AdminLayout title="Monitores">
      <div className="min-h-screen bg-[#0a0f1a] text-white p-6 -m-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <UserCheck className="w-6 h-6 text-emerald-400" />
              Gestión de Monitores
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Fichas de personal, documentos y nóminas
            </p>
          </div>
          <Button
            onClick={() => { setForm({ ...EMPTY_FORM }); setShowCreateModal(true); }}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Monitor
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-emerald-500/10 rounded-xl border border-emerald-500/30 p-4">
            <div className="text-3xl font-bold text-emerald-300">{activeMonitors.length}</div>
            <div className="text-slate-400 text-sm mt-1">Monitores activos</div>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div className="text-3xl font-bold text-white">{monitors.length}</div>
            <div className="text-slate-400 text-sm mt-1">Total monitores</div>
          </div>
          <div className="bg-red-500/10 rounded-xl border border-red-500/30 p-4">
            <div className="text-3xl font-bold text-red-300">{inactiveMonitors.length}</div>
            <div className="text-slate-400 text-sm mt-1">Inactivos</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar monitor por nombre, email o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-slate-800 border-slate-600 text-white placeholder:text-slate-500"
          />
        </div>

        {/* Monitors List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            Cargando monitores...
          </div>
        ) : monitors.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No hay monitores registrados</p>
            <Button
              onClick={() => { setForm({ ...EMPTY_FORM }); setShowCreateModal(true); }}
              className="mt-4 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="w-4 h-4 mr-2" />
              Añadir primer monitor
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {monitors.map((monitor: any) => {
              const isExpanded = expandedId === monitor.id;
              return (
                <div
                  key={monitor.id}
                  className={`bg-[#111827] border rounded-xl overflow-hidden transition-colors ${
                    monitor.isActive ? "border-slate-700" : "border-red-500/20 opacity-70"
                  }`}
                >
                  {/* Monitor row */}
                  <div className="flex items-center gap-4 p-5">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                      <span className="text-emerald-300 font-bold text-lg">
                        {monitor.fullName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white">{monitor.fullName}</h3>
                        {!monitor.isActive && (
                          <Badge className="bg-red-500/20 text-red-300 border-red-500 text-xs">
                            Inactivo
                          </Badge>
                        )}
                        {monitor.contractType && (
                          <Badge className="bg-slate-700 text-slate-300 border-slate-600 text-xs capitalize">
                            {monitor.contractType}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-slate-400 flex-wrap">
                        {monitor.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="w-3.5 h-3.5" />
                            {monitor.email}
                          </span>
                        )}
                        {monitor.phone && (
                          <a href={`tel:${monitor.phone}`} className="flex items-center gap-1 text-blue-400 hover:text-blue-300">
                            <Phone className="w-3.5 h-3.5" />
                            {monitor.phone}
                          </a>
                        )}
                        {monitor.contractStart && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Desde {formatDate(monitor.contractStart)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(monitor)}
                        className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                      >
                        <Edit3 className="w-3.5 h-3.5 mr-1" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDeleteId(monitor.id)}
                        className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setExpandedId(isExpanded ? null : monitor.id);
                          setActiveTab("info");
                        }}
                        className="border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Expanded panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-700">
                      {/* Tab bar */}
                      <div className="flex border-b border-slate-700">
                        {(["info", "payroll", "docs"] as const).map((tab) => (
                          <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-5 py-3 text-sm font-medium transition-colors ${
                              activeTab === tab
                                ? "text-white border-b-2 border-emerald-400"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {tab === "info" && "Información"}
                            {tab === "payroll" && "Nóminas"}
                            {tab === "docs" && "Documentos"}
                          </button>
                        ))}
                      </div>

                      <div className="p-5">
                        {/* INFO TAB */}
                        {activeTab === "info" && (
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            {[
                              { label: "Nombre completo", value: monitor.fullName },
                              { label: "DNI / NIE", value: monitor.dni || "—" },
                              { label: "Email", value: monitor.email || "—" },
                              { label: "Teléfono", value: monitor.phone || "—" },
                              { label: "Tipo de contrato", value: monitor.contractType || "—" },
                              { label: "Fecha inicio contrato", value: formatDate(monitor.contractStart) },
                              { label: "Fecha fin contrato", value: formatDate(monitor.contractEnd) },
                              { label: "Fecha nacimiento", value: formatDate(monitor.birthDate) },
                              { label: "Contacto emergencia", value: monitor.emergencyName || "—" },
                              { label: "Tel. emergencia", value: monitor.emergencyPhone || "—" },
                              { label: "IBAN", value: monitor.iban || "—" },
                              { label: "Titular cuenta", value: monitor.ibanHolder || "—" },
                            ].map((f) => (
                              <div key={f.label} className="bg-slate-800 rounded-lg p-3">
                                <div className="text-slate-400 text-xs mb-1">{f.label}</div>
                                <div className="text-white font-medium">{f.value}</div>
                              </div>
                            ))}
                            {monitor.notes && (
                              <div className="col-span-2 bg-slate-800 rounded-lg p-3">
                                <div className="text-slate-400 text-xs mb-1">Notas</div>
                                <div className="text-white">{monitor.notes}</div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* PAYROLL TAB */}
                        {activeTab === "payroll" && (
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="font-semibold text-white">Historial de Nóminas</h4>
                              <Button
                                size="sm"
                                onClick={() => setShowPayrollModal(true)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                              >
                                <Plus className="w-3.5 h-3.5 mr-1" />
                                Nueva nómina
                              </Button>
                            </div>
                            {payrolls.length === 0 ? (
                              <div className="text-center py-8 text-slate-500">
                                <Euro className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">Sin nóminas registradas</p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {payrolls.map((p: any) => (
                                  <div key={p.id} className="bg-slate-800 rounded-lg p-4 flex items-center justify-between">
                                    <div>
                                      <div className="font-medium text-white">
                                        {MONTHS[(p.month ?? 1) - 1]} {p.year}
                                      </div>
                                      <div className="text-sm text-slate-400 mt-1">
                                        Base: {formatCurrency(p.baseSalary)}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-lg font-bold text-white">
                                        {formatCurrency(p.totalAmount)}
                                      </div>
                                      <Badge className={
                                        p.status === "pagado"
                                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500 text-xs"
                                          : "bg-slate-700 text-slate-300 border-slate-600 text-xs"
                                      }>
                                        {p.status}
                                      </Badge>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* DOCS TAB */}
                        {activeTab === "docs" && (
                          <div>
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="font-semibold text-white">Documentos</h4>
                            </div>
                            {docs.length === 0 ? (
                              <div className="text-center py-8 text-slate-500">
                                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">Sin documentos adjuntos</p>
                                <p className="text-xs text-slate-600 mt-1">
                                  La subida de documentos estará disponible próximamente
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {docs.map((d: any) => (
                                  <div key={d.id} className="bg-slate-800 rounded-lg p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                      <FileText className="w-5 h-5 text-blue-400" />
                                      <div>
                                        <div className="text-white text-sm font-medium">{d.name}</div>
                                        <div className="text-slate-400 text-xs">{d.type} · {formatDate(d.createdAt)}</div>
                                      </div>
                                    </div>
                                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer">
                                      <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 text-xs">
                                        <Download className="w-3.5 h-3.5 mr-1" />
                                        Ver
                                      </Button>
                                    </a>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {(showCreateModal || showEditModal) && (
        <Dialog open onOpenChange={() => { setShowCreateModal(false); setShowEditModal(false); }}>
          <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white">
                {showCreateModal ? "Nuevo Monitor" : "Editar Monitor"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              {/* Datos personales */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Datos personales</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 block mb-1">Nombre completo *</label>
                    <Input value={form.fullName} onChange={(e) => setForm(f => ({ ...f, fullName: e.target.value }))}
                      placeholder="Nombre y apellidos" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">DNI / NIE</label>
                    <Input value={form.dni} onChange={(e) => setForm(f => ({ ...f, dni: e.target.value }))}
                      placeholder="12345678A" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fecha de nacimiento</label>
                    <Input type="date" value={form.birthDate} onChange={(e) => setForm(f => ({ ...f, birthDate: e.target.value }))}
                      className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Email</label>
                    <Input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="correo@ejemplo.com" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Teléfono</label>
                    <Input value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="+34 600 000 000" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-slate-400 block mb-1">Dirección</label>
                    <Input value={form.address} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                      placeholder="Calle, número, ciudad" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                </div>
              </div>

              {/* Contacto emergencia */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contacto de emergencia</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Nombre</label>
                    <Input value={form.emergencyName} onChange={(e) => setForm(f => ({ ...f, emergencyName: e.target.value }))}
                      placeholder="Nombre" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Relación</label>
                    <Input value={form.emergencyRelation} onChange={(e) => setForm(f => ({ ...f, emergencyRelation: e.target.value }))}
                      placeholder="Familiar, pareja..." className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Teléfono</label>
                    <Input value={form.emergencyPhone} onChange={(e) => setForm(f => ({ ...f, emergencyPhone: e.target.value }))}
                      placeholder="+34 600 000 000" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                </div>
              </div>

              {/* Datos bancarios */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  Datos bancarios
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">IBAN</label>
                    <Input value={form.iban} onChange={(e) => setForm(f => ({ ...f, iban: e.target.value }))}
                      placeholder="ES00 0000 0000 0000 0000 0000" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Titular</label>
                    <Input value={form.ibanHolder} onChange={(e) => setForm(f => ({ ...f, ibanHolder: e.target.value }))}
                      placeholder="Nombre del titular" className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                </div>
              </div>

              {/* Contrato */}
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Contrato</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Tipo de contrato</label>
                    <Select value={form.contractType} onValueChange={(v) => setForm(f => ({ ...f, contractType: v as any }))}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        {CONTRACT_OPTIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value} className="text-white">{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fecha inicio</label>
                    <Input type="date" value={form.contractStart} onChange={(e) => setForm(f => ({ ...f, contractStart: e.target.value }))}
                      className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Fecha fin</label>
                    <Input type="date" value={form.contractEnd} onChange={(e) => setForm(f => ({ ...f, contractEnd: e.target.value }))}
                      className="bg-slate-800 border-slate-600 text-white" />
                  </div>
                  <div className="col-span-3">
                    <label className="text-xs text-slate-400 block mb-1">Condiciones del contrato</label>
                    <Textarea value={form.contractConditions} onChange={(e) => setForm(f => ({ ...f, contractConditions: e.target.value }))}
                      placeholder="Descripción de condiciones, jornada, etc." className="bg-slate-800 border-slate-600 text-white text-sm resize-none" rows={2} />
                  </div>
                </div>
              </div>

              {/* Estado (solo en edición) */}
              {showEditModal && (
                <div className="flex items-center gap-3">
                  <label className="text-xs text-slate-400">Estado del monitor:</label>
                  <button
                    onClick={() => setForm(f => ({ ...f, isActive: !f.isActive }))}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      form.isActive ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                    }`}
                  >
                    {form.isActive ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {form.isActive ? "Activo" : "Inactivo"}
                  </button>
                </div>
              )}

              {/* Notas */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">Notas</label>
                <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Observaciones, certificaciones, etc." className="bg-slate-800 border-slate-600 text-white text-sm resize-none" rows={2} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <Button variant="outline" onClick={() => { setShowCreateModal(false); setShowEditModal(false); }}
                className="border-slate-600 text-slate-300">
                <X className="w-4 h-4 mr-1" />
                Cancelar
              </Button>
              <Button
                onClick={showCreateModal ? handleCreate : handleUpdate}
                disabled={!form.fullName || createMutation.isPending || updateMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Save className="w-4 h-4 mr-1" />
                {showCreateModal ? "Crear monitor" : "Guardar cambios"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Add Payroll Modal */}
      <Dialog open={showPayrollModal} onOpenChange={setShowPayrollModal}>
        <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">Nueva Nómina</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Mes *</label>
                <Select
                  value={String(payrollForm.month)}
                  onValueChange={(v) => setPayrollForm(f => ({ ...f, month: parseInt(v) }))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {MONTHS.map((m, i) => (
                      <SelectItem key={i+1} value={String(i+1)} className="text-white">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Año *</label>
                <Input
                  type="number"
                  value={payrollForm.year}
                  onChange={(e) => setPayrollForm(f => ({ ...f, year: parseInt(e.target.value) || new Date().getFullYear() }))}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Salario base (€) *</label>
                <Input
                  type="number"
                  step="0.01"
                  value={payrollForm.baseSalary}
                  onChange={(e) => setPayrollForm(f => ({ ...f, baseSalary: e.target.value, totalAmount: e.target.value }))}
                  placeholder="1500.00"
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Total a pagar (€)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={payrollForm.totalAmount}
                  onChange={(e) => setPayrollForm(f => ({ ...f, totalAmount: e.target.value }))}
                  placeholder="= salario base si no hay extras"
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Notas</label>
              <Textarea
                value={payrollForm.notes}
                onChange={(e) => setPayrollForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Observaciones, horas extra, etc."
                className="bg-slate-800 border-slate-600 text-white text-sm resize-none"
                rows={2}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowPayrollModal(false)} className="border-slate-600 text-slate-300">
                Cancelar
              </Button>
              <Button
                onClick={handleAddPayroll}
                disabled={!payrollForm.baseSalary || addPayrollMutation.isPending}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <Save className="w-4 h-4 mr-1" />
                Guardar nómina
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!confirmDeleteId} onOpenChange={() => setConfirmDeleteId(null)}>
        <DialogContent className="bg-[#111827] border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-400" />
              Eliminar Monitor
            </DialogTitle>
          </DialogHeader>
          <p className="text-slate-400 text-sm mt-2">
            ¿Estás seguro de que quieres eliminar este monitor? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)} className="border-slate-600 text-slate-300">
              Cancelar
            </Button>
            <Button
              onClick={() => confirmDeleteId && deleteMutation.mutate({ id: confirmDeleteId })}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
