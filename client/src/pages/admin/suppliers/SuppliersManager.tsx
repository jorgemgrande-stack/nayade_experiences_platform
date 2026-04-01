import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Building2, Plus, Search, Phone, Mail, CreditCard, User, MapPin,
  Edit, Trash2, Package, BarChart3, AlertTriangle, CheckCircle2, XCircle,
  ChevronRight, Percent, Calendar, RefreshCw, Clock, Zap
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Supplier = {
  id: number;
  fiscalName: string;
  commercialName?: string | null;
  nif?: string | null;
  fiscalAddress?: string | null;
  adminEmail?: string | null;
  phone?: string | null;
  contactPerson?: string | null;
  iban?: string | null;
  paymentMethod: string;
  standardCommissionPercent: string;
  settlementFrequency: "quincenal" | "mensual" | "trimestral" | "semestral" | "anual" | "manual";
  settlementDayOfMonth?: number | null;
  autoGenerateSettlements: boolean;
  internalNotes?: string | null;
  status: "activo" | "inactivo" | "bloqueado";
};

type SupplierForm = {
  fiscalName: string;
  commercialName: string;
  nif: string;
  fiscalAddress: string;
  adminEmail: string;
  phone: string;
  contactPerson: string;
  iban: string;
  paymentMethod: "transferencia" | "confirming" | "efectivo" | "compensacion";
  standardCommissionPercent: number;
  settlementFrequency: "quincenal" | "mensual" | "trimestral" | "semestral" | "anual" | "manual";
  settlementDayOfMonth: number;
  autoGenerateSettlements: boolean;
  internalNotes: string;
  status: "activo" | "inactivo" | "bloqueado";
};

const defaultForm: SupplierForm = {
  fiscalName: "",
  commercialName: "",
  nif: "",
  fiscalAddress: "",
  adminEmail: "",
  phone: "",
  contactPerson: "",
  iban: "",
  paymentMethod: "transferencia",
  standardCommissionPercent: 0,
  settlementFrequency: "manual",
  settlementDayOfMonth: 1,
  autoGenerateSettlements: false,
  internalNotes: "",
  status: "activo",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FREQ_LABELS: Record<string, string> = {
  quincenal: "Quincenal",
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  manual: "Manual",
};

const FREQ_COLORS: Record<string, string> = {
  quincenal: "bg-purple-100 text-purple-800 border-purple-200",
  mensual: "bg-blue-100 text-blue-800 border-blue-200",
  trimestral: "bg-cyan-100 text-cyan-800 border-cyan-200",
  semestral: "bg-teal-100 text-teal-800 border-teal-200",
  anual: "bg-green-100 text-green-800 border-green-200",
  manual: "bg-slate-100 text-slate-600 border-slate-200",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "activo") return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" />Activo</Badge>;
  if (status === "inactivo") return <Badge className="bg-slate-100 text-slate-600 border-slate-200"><XCircle className="w-3 h-3 mr-1" />Inactivo</Badge>;
  return <Badge className="bg-red-100 text-red-700 border-red-200"><AlertTriangle className="w-3 h-3 mr-1" />Bloqueado</Badge>;
}

function PaymentBadge({ method }: { method: string }) {
  const map: Record<string, string> = {
    transferencia: "Transferencia",
    confirming: "Confirming",
    efectivo: "Efectivo",
    compensacion: "Compensación",
  };
  return <Badge variant="outline" className="text-xs">{map[method] ?? method}</Badge>;
}

function FreqBadge({ freq }: { freq: string }) {
  return (
    <Badge className={`text-xs border ${FREQ_COLORS[freq] ?? FREQ_COLORS.manual}`}>
      <Calendar className="w-3 h-3 mr-1" />
      {FREQ_LABELS[freq] ?? freq}
    </Badge>
  );
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Settlement Periods Panel ─────────────────────────────────────────────────

function SettlementPeriodsPanel({ supplier }: { supplier: Supplier }) {
  const utils = trpc.useUtils();

  const { data: periods, isLoading: loadingPeriods } = trpc.suppliers.getNextPeriods.useQuery(
    { supplierId: supplier.id },
    { enabled: supplier.settlementFrequency !== "manual" }
  );

  const generateMutation = trpc.suppliers.generatePending.useMutation({
    onSuccess: (data) => {
      utils.suppliers.getNextPeriods.invalidate({ supplierId: supplier.id });
      utils.settlements.list.invalidate();
      toast.success(data.message ?? `${data.created} liquidación(es) creada(s)`);
    },
    onError: (e) => toast.error(`Error: ${e.message}`),
  });

  if (supplier.settlementFrequency === "manual") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            Liquidaciones automáticas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400 text-center py-3">
            Este proveedor tiene periodicidad <strong>manual</strong>. Las liquidaciones se crean manualmente desde el módulo de Liquidaciones.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-500" />
            Liquidaciones automáticas
            <FreqBadge freq={supplier.settlementFrequency} />
          </CardTitle>
          {supplier.autoGenerateSettlements && (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-xs">
              <Zap className="w-3 h-3 mr-1" />Auto-generación activa
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingPeriods ? (
          <p className="text-sm text-slate-400 text-center py-2">Calculando periodos...</p>
        ) : (
          <>
            {/* Periodos pendientes */}
            {periods && periods.pendingPeriods.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {periods.pendingPeriods.length} periodo(s) pendiente(s) de liquidar
                </p>
                <div className="space-y-1.5 mb-3">
                  {periods.pendingPeriods.map((p, i) => (
                    <div key={i} className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                      <span className="text-amber-800 font-medium">
                        {formatDate(p.from)} — {formatDate(p.to)}
                      </span>
                      <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-xs">Pendiente</Badge>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => generateMutation.mutate({ supplierId: supplier.id })}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <><RefreshCw className="w-3 h-3 mr-2 animate-spin" />Generando...</>
                  ) : (
                    <><Zap className="w-3 h-3 mr-2" />Generar {periods.pendingPeriods.length} liquidación(es) pendiente(s)</>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                <CheckCircle2 className="w-4 h-4" />
                Al día — no hay periodos pendientes de liquidar
              </div>
            )}

            {/* Próximo periodo */}
            {periods && periods.nextPeriodFrom && (
              <div className="border-t pt-3">
                <p className="text-xs text-slate-500 mb-1">Próximo periodo a liquidar:</p>
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium">{formatDate(periods.nextPeriodFrom)} — {formatDate(periods.nextPeriodTo)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SuppliersManager() {

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SupplierForm>(defaultForm);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: suppliers = [], isLoading } = trpc.suppliers.list.useQuery({
    status: statusFilter as any,
    search: search || undefined,
  });

  const { data: products = [] } = trpc.suppliers.getProducts.useQuery(
    { supplierId: selected?.id ?? 0 },
    { enabled: !!selected }
  );

  const createMutation = trpc.suppliers.create.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      setShowForm(false);
      setForm(defaultForm);
      toast.success("Proveedor creado correctamente");
    },
    onError: (e) => toast.error(`Error al crear proveedor: ${e.message}`),
  });

  const updateMutation = trpc.suppliers.update.useMutation({
    onSuccess: (_, vars) => {
      utils.suppliers.list.invalidate();
      utils.suppliers.get.invalidate({ id: vars.id });
      utils.suppliers.getNextPeriods.invalidate({ supplierId: vars.id });
      setShowForm(false);
      setEditingId(null);
      setForm(defaultForm);
      // Actualizar el selected con los nuevos datos
      setSelected((prev) => prev ? {
        ...prev,
        ...vars,
        standardCommissionPercent: String(vars.standardCommissionPercent ?? prev.standardCommissionPercent),
      } as Supplier : prev);
      toast.success("Proveedor actualizado correctamente");
    },
    onError: (e) => toast.error(`Error al actualizar: ${e.message}`),
  });

  const deleteMutation = trpc.suppliers.delete.useMutation({
    onSuccess: () => {
      utils.suppliers.list.invalidate();
      setShowDeleteConfirm(null);
      if (selected?.id === showDeleteConfirm) setSelected(null);
      toast.success("Proveedor eliminado");
    },
    onError: (e) => toast.error(`Error al eliminar: ${e.message}`),
  });

  function openCreate() {
    setEditingId(null);
    setForm(defaultForm);
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditingId(s.id);
    setForm({
      fiscalName: s.fiscalName,
      commercialName: s.commercialName ?? "",
      nif: s.nif ?? "",
      fiscalAddress: s.fiscalAddress ?? "",
      adminEmail: s.adminEmail ?? "",
      phone: s.phone ?? "",
      contactPerson: s.contactPerson ?? "",
      iban: s.iban ?? "",
      paymentMethod: s.paymentMethod as SupplierForm["paymentMethod"],
      standardCommissionPercent: parseFloat(s.standardCommissionPercent ?? "0"),
      settlementFrequency: s.settlementFrequency ?? "manual",
      settlementDayOfMonth: s.settlementDayOfMonth ?? 1,
      autoGenerateSettlements: s.autoGenerateSettlements ?? false,
      internalNotes: s.internalNotes ?? "",
      status: s.status,
    });
    setShowForm(true);
  }

  function handleSubmit() {
    const payload = {
      fiscalName: form.fiscalName,
      commercialName: form.commercialName || undefined,
      nif: form.nif || undefined,
      fiscalAddress: form.fiscalAddress || undefined,
      adminEmail: form.adminEmail || undefined,
      phone: form.phone || undefined,
      contactPerson: form.contactPerson || undefined,
      iban: form.iban || undefined,
      paymentMethod: form.paymentMethod,
      standardCommissionPercent: form.standardCommissionPercent,
      settlementFrequency: form.settlementFrequency,
      settlementDayOfMonth: form.settlementDayOfMonth,
      autoGenerateSettlements: form.autoGenerateSettlements,
      internalNotes: form.internalNotes || undefined,
      status: form.status,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const costTypeLabel: Record<string, string> = {
    comision_sobre_venta: "Comisión s/venta",
    coste_fijo: "Coste fijo",
    porcentaje_margen: "% Margen",
    hibrido: "Híbrido",
  };

  return (
    <AdminLayout>
    <div className="flex h-full min-h-screen bg-slate-50">
      {/* ── Left panel: list ── */}
      <div className="w-80 flex-shrink-0 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-600" />
              Proveedores
            </h2>
            <Button size="sm" onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Plus className="w-3 h-3 mr-1" />Nuevo
            </Button>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Buscar proveedor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="activo">Activo</SelectItem>
              <SelectItem value="inactivo">Inactivo</SelectItem>
              <SelectItem value="bloqueado">Bloqueado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-slate-400">Cargando...</div>
          ) : suppliers.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No hay proveedores
            </div>
          ) : (
            suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s as Supplier)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-slate-50 transition-colors flex items-center gap-3 ${selected?.id === s.id ? "bg-blue-50 border-l-2 border-l-blue-500" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-800 truncate">{(s as any).commercialName || s.fiscalName}</div>
                  <div className="text-xs text-slate-500 truncate">{s.nif ?? "Sin NIF"} · {s.adminEmail ?? "Sin email"}</div>
                  <div className="mt-1">
                    <FreqBadge freq={(s as any).settlementFrequency ?? "manual"} />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-slate-400">{s.standardCommissionPercent}%</span>
                </div>
                <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: detail ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <Building2 className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">Selecciona un proveedor</p>
            <p className="text-sm">o crea uno nuevo con el botón "Nuevo"</p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">{selected.commercialName || selected.fiscalName}</h1>
                {selected.commercialName && (
                  <p className="text-sm text-slate-500">{selected.fiscalName}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <StatusBadge status={selected.status} />
                  <PaymentBadge method={selected.paymentMethod} />
                  <Badge variant="outline" className="text-xs">
                    <Percent className="w-3 h-3 mr-1" />
                    {selected.standardCommissionPercent}% comisión estándar
                  </Badge>
                  <FreqBadge freq={selected.settlementFrequency ?? "manual"} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(selected)}>
                  <Edit className="w-3 h-3 mr-1" />Editar
                </Button>
                <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setShowDeleteConfirm(selected.id)}>
                  <Trash2 className="w-3 h-3 mr-1" />Eliminar
                </Button>
              </div>
            </div>

            {/* Datos fiscales y contacto */}
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-500" />Datos Fiscales
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">NIF/CIF</span>
                    <span className="font-medium">{selected.nif ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Dirección fiscal</span>
                    <span className="font-medium text-right max-w-[180px]">{selected.fiscalAddress ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">IBAN</span>
                    <span className="font-mono text-xs">{selected.iban ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Forma de pago</span>
                    <PaymentBadge method={selected.paymentMethod} />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <User className="w-4 h-4 text-blue-500" />Contacto
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <User className="w-3 h-3 text-slate-400" />
                    <span>{selected.contactPerson ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <a href={`mailto:${selected.adminEmail}`} className="text-blue-600 hover:underline truncate">
                      {selected.adminEmail ?? "—"}
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{selected.phone ?? "—"}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Panel de liquidaciones automáticas */}
            <SettlementPeriodsPanel supplier={selected} />

            {/* Productos vinculados */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Package className="w-4 h-4 text-blue-500" />
                  Productos vinculados
                  <Badge variant="secondary" className="ml-auto">{products.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {products.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-3">No hay productos vinculados a este proveedor</p>
                ) : (
                  <div className="space-y-2">
                    {products.map((p: any) => (
                      <div key={`${p.type}-${p.id}`} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div>
                          <span className="text-sm font-medium text-slate-800">{p.title}</span>
                          <Badge variant="outline" className="ml-2 text-xs">{p.type === "experience" ? "Experiencia" : "Pack"}</Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>{costTypeLabel[p.supplierCostType ?? "comision_sobre_venta"]}</span>
                          <span className="font-medium text-slate-700">{p.supplierCommissionPercent ?? "0"}%</span>
                          <Badge variant={p.isSettlable ? "default" : "secondary"} className="text-xs">
                            {p.isSettlable ? "Liquidable" : "No liquidable"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Notas internas */}
            {selected.internalNotes && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-slate-700">Notas internas</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{selected.internalNotes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* ── Create/Edit modal ── */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditingId(null); setForm(defaultForm); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Datos básicos */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Razón social / Nombre fiscal *</Label>
                <Input value={form.fiscalName} onChange={(e) => setForm({ ...form, fiscalName: e.target.value })} placeholder="Empresa S.L." />
              </div>
              <div>
                <Label>Nombre comercial</Label>
                <Input value={form.commercialName} onChange={(e) => setForm({ ...form, commercialName: e.target.value })} placeholder="Nombre visible" />
              </div>
              <div>
                <Label>NIF / CIF</Label>
                <Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder="B12345678" />
              </div>
              <div className="col-span-2">
                <Label>Dirección fiscal</Label>
                <Input value={form.fiscalAddress} onChange={(e) => setForm({ ...form, fiscalAddress: e.target.value })} placeholder="Calle, número, ciudad, CP" />
              </div>
            </div>

            <Separator />

            {/* Contacto */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Contacto</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Persona de contacto</Label>
                <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="Nombre y apellidos" />
              </div>
              <div>
                <Label>Teléfono</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+34 600 000 000" />
              </div>
              <div className="col-span-2">
                <Label>Email de administración</Label>
                <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="admin@proveedor.com" />
              </div>
            </div>

            <Separator />

            {/* Datos bancarios y comisión */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Datos bancarios y comisión</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>IBAN</Label>
                <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES00 0000 0000 0000 0000 0000" className="font-mono" />
              </div>
              <div>
                <Label>Forma de pago</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as SupplierForm["paymentMethod"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transferencia">Transferencia bancaria</SelectItem>
                    <SelectItem value="confirming">Confirming</SelectItem>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="compensacion">Compensación</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comisión estándar (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.standardCommissionPercent}
                  onChange={(e) => setForm({ ...form, standardCommissionPercent: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <Separator />

            {/* Configuración de liquidaciones */}
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              Configuración de liquidaciones
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Periodicidad de liquidación</Label>
                <Select
                  value={form.settlementFrequency}
                  onValueChange={(v) => setForm({ ...form, settlementFrequency: v as SupplierForm["settlementFrequency"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual (sin automatización)</SelectItem>
                    <SelectItem value="quincenal">Quincenal (cada 15 días)</SelectItem>
                    <SelectItem value="mensual">Mensual</SelectItem>
                    <SelectItem value="trimestral">Trimestral (cada 3 meses)</SelectItem>
                    <SelectItem value="semestral">Semestral (cada 6 meses)</SelectItem>
                    <SelectItem value="anual">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.settlementFrequency !== "manual" && form.settlementFrequency !== "quincenal" && (
                <div>
                  <Label>Día del mes para liquidar</Label>
                  <Input
                    type="number"
                    min={1}
                    max={28}
                    value={form.settlementDayOfMonth}
                    onChange={(e) => setForm({ ...form, settlementDayOfMonth: parseInt(e.target.value) || 1 })}
                    placeholder="1-28"
                  />
                  <p className="text-xs text-slate-400 mt-1">Día en que se genera la liquidación del periodo anterior</p>
                </div>
              )}
            </div>
            {form.settlementFrequency !== "manual" && (
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border">
                <div>
                  <p className="text-sm font-medium text-slate-700">Auto-generación de liquidaciones</p>
                  <p className="text-xs text-slate-500">Crear automáticamente borradores de liquidación al inicio de cada periodo</p>
                </div>
                <Switch
                  checked={form.autoGenerateSettlements}
                  onCheckedChange={(v) => setForm({ ...form, autoGenerateSettlements: v })}
                />
              </div>
            )}

            <Separator />

            {/* Estado y notas */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Estado</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as SupplierForm["status"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="activo">Activo</SelectItem>
                    <SelectItem value="inactivo">Inactivo</SelectItem>
                    <SelectItem value="bloqueado">Bloqueado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Notas internas</Label>
              <Textarea value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} rows={3} placeholder="Condiciones especiales, acuerdos, etc." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setForm(defaultForm); }}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.fiscalName || createMutation.isPending || updateMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {createMutation.isPending || updateMutation.isPending ? "Guardando..." : editingId ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={(v) => { if (!v) setShowDeleteConfirm(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar proveedor?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600">Esta acción no se puede deshacer. Las liquidaciones asociadas quedarán sin proveedor vinculado.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => showDeleteConfirm && deleteMutation.mutate({ id: showDeleteConfirm })}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </AdminLayout>
  );
}
