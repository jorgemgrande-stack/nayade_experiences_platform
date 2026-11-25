import { useState, type ReactNode } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "@/pages/admin/accounting/shared/EconomyUi";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  Building2, Plus, Phone, Mail, User, Package, AlertTriangle, CheckCircle2, XCircle,
  Percent, Calendar, RefreshCw, Clock, Zap, Pencil, Trash2, Eye, Landmark, StickyNote,
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

const STATUS_LABELS: Record<string, string> = { activo: "Activo", inactivo: "Inactivo", bloqueado: "Bloqueado" };

const PAYMENT_LABELS: Record<string, string> = {
  transferencia: "Transferencia",
  confirming: "Confirming",
  efectivo: "Efectivo",
  compensacion: "Compensación",
};

function SupplierStatus({ status }: { status: string }) {
  if (status === "activo") return <StatusBadge tone="success" icon={<CheckCircle2 />}>Activo</StatusBadge>;
  if (status === "inactivo") return <StatusBadge tone="neutral" icon={<XCircle />}>Inactivo</StatusBadge>;
  return <StatusBadge tone="danger" icon={<AlertTriangle />}>Bloqueado</StatusBadge>;
}

function PaymentBadge({ method }: { method: string }) {
  return <Badge variant="outline" className="text-xs">{PAYMENT_LABELS[method] ?? method}</Badge>;
}

function FreqBadge({ freq }: { freq: string }) {
  const tone: Tone = freq === "manual" ? "neutral" : "brand";
  return <StatusBadge tone={tone} icon={<Calendar />}>{FREQ_LABELS[freq] ?? freq}</StatusBadge>;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/** Bloque de la ficha: título con icono y contenido. */
function InfoBlock({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-primary">{icon}{title}</h3>
        {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium text-foreground">{children}</span>
    </div>
  );
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
      <InfoBlock icon={<Calendar />} title="Liquidaciones automáticas">
        <p className="py-2 text-sm text-muted-foreground">
          Este proveedor tiene periodicidad <strong className="text-foreground">manual</strong>. Las liquidaciones se crean manualmente desde el módulo de Liquidaciones.
        </p>
      </InfoBlock>
    );
  }

  return (
    <InfoBlock
      icon={<Calendar />}
      title="Liquidaciones automáticas"
      aside={
        <>
          <FreqBadge freq={supplier.settlementFrequency} />
          {supplier.autoGenerateSettlements && <StatusBadge tone="success" icon={<Zap />}>Auto-generación activa</StatusBadge>}
        </>
      }
    >
      <div className="space-y-4">
        {loadingPeriods ? (
          <PanelLoading label="Calculando periodos…" className="py-4" />
        ) : (
          <>
            {periods && periods.pendingPeriods.length > 0 ? (
              <div>
                <p className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-warning">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {periods.pendingPeriods.length} periodo(s) pendiente(s) de liquidar
                </p>
                <div className="mb-3 space-y-1.5">
                  {periods.pendingPeriods.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
                      <span className="font-medium text-foreground">{formatDate(p.from)} — {formatDate(p.to)}</span>
                      <StatusBadge tone="warning">Pendiente</StatusBadge>
                    </div>
                  ))}
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => generateMutation.mutate({ supplierId: supplier.id })}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? (
                    <><RefreshCw className="mr-2 h-3 w-3 animate-spin" />Generando...</>
                  ) : (
                    <><Zap className="mr-2 h-3 w-3" />Generar {periods.pendingPeriods.length} liquidación(es) pendiente(s)</>
                  )}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                Al día — no hay periodos pendientes de liquidar
              </div>
            )}

            {periods && periods.nextPeriodFrom && (
              <div className="border-t border-border pt-3">
                <p className="mb-1 text-xs text-muted-foreground">Próximo periodo a liquidar:</p>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{formatDate(periods.nextPeriodFrom)} — {formatDate(periods.nextPeriodTo)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </InfoBlock>
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

  const { data: suppliers = [], isLoading, error, refetch } = trpc.suppliers.list.useQuery({
    status: statusFilter as any,
    search: search || undefined,
  });

  // Resumen: la misma lista sin filtros (solo lectura, para los indicadores)
  const { data: allSuppliers = [] } = trpc.suppliers.list.useQuery({ status: "all" as any });

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

  const inviteMutation = trpc.suppliers.inviteSupplierUser.useMutation({
    onSuccess: (r) => toast.success(`Invitación enviada a ${r.email}. El proveedor podrá activar su portal.`),
    onError: (e) => toast.error(`Error al invitar: ${e.message}`),
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

  async function inviteSupplier(s: Supplier) {
    const email = s.adminEmail?.trim();
    if (!email) { toast.error("El proveedor no tiene email. Edítalo y añade uno antes de invitar."); return; }
    if ((await confirmAction({ description: `¿Enviar invitación al portal de proveedor a ${email}?` })))
      inviteMutation.mutate({ supplierId: s.id });
  }

  const costTypeLabel: Record<string, string> = {
    comision_sobre_venta: "Comisión s/venta",
    coste_fijo: "Coste fijo",
    porcentaje_margen: "% Margen",
    hibrido: "Híbrido",
  };

  const all = allSuppliers as Supplier[];
  const activeCount = all.filter((s) => s.status === "activo").length;
  const blockedCount = all.filter((s) => s.status === "bloqueado").length;
  const autoCount = all.filter((s) => s.autoGenerateSettlements).length;
  const filtered = search.trim() !== "" || statusFilter !== "all";
  const chips: FilterChip[] = [
    ...(search.trim() ? [{ id: "q", label: `Búsqueda: ${search.trim()}`, onRemove: () => setSearch("") }] : []),
    ...(statusFilter !== "all" ? [{ id: "status", label: `Estado: ${STATUS_LABELS[statusFilter] ?? statusFilter}`, onRemove: () => setStatusFilter("all") }] : []),
  ];
  const clearAll = () => { setSearch(""); setStatusFilter("all"); };

  const columns: EconomyColumn<Supplier>[] = [
    {
      key: "name", header: "Proveedor", mobile: "title", cell: (s) => (
        <div className="min-w-0">
          <div className="break-words font-medium text-foreground">{s.commercialName || s.fiscalName}</div>
          <div className="break-all text-xs text-muted-foreground">{s.nif ?? "Sin NIF"}{s.adminEmail ? ` · ${s.adminEmail}` : ""}</div>
        </div>
      ),
    },
    { key: "status", header: "Estado", cell: (s) => <SupplierStatus status={s.status} /> },
    { key: "freq", header: "Liquidación", priority: "md", cell: (s) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <FreqBadge freq={s.settlementFrequency ?? "manual"} />
        {s.autoGenerateSettlements && <Zap className="h-3.5 w-3.5 text-success" aria-label="Auto-generación activa" />}
      </span>
    ) },
    { key: "pay", header: "Forma de pago", priority: "lg", cell: (s) => <PaymentBadge method={s.paymentMethod} /> },
    { key: "commission", header: "Comisión", align: "right", num: true, mobile: "amount", cell: (s) => `${s.standardCommissionPercent}%` },
  ];

  const selectedLive = selected ? ((all.find((s) => s.id === selected.id) as Supplier | undefined) ?? selected) : null;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <PanelPageHeader
          className="mb-0"
          icon={<Building2 />}
          title="Proveedores"
          description="Ficha fiscal, comisión y periodicidad de liquidación de cada proveedor."
          actions={<Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo proveedor</Button>}
        />

        <EconomySummary>
          <MetricCard icon={<Building2 />} tone="brand" label="Proveedores" value={all.length} detail={`${activeCount} activos`} />
          <MetricCard icon={<CheckCircle2 />} tone="success" label="Activos" value={activeCount} onClick={() => setStatusFilter(statusFilter === "activo" ? "all" : "activo")} active={statusFilter === "activo"} />
          <MetricCard icon={<AlertTriangle />} tone={blockedCount ? "danger" : "neutral"} label="Bloqueados" value={blockedCount} onClick={() => setStatusFilter(statusFilter === "bloqueado" ? "all" : "bloqueado")} active={statusFilter === "bloqueado"} />
          <MetricCard icon={<Zap />} tone="info" label="Con liquidación automática" value={autoCount} />
        </EconomySummary>

        <EconomyFilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Buscar por nombre, NIF o email…" }}
          primary={
            <FilterField label="Estado" className="w-full sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                  <SelectItem value="bloqueado">Bloqueado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          }
          chips={chips}
          onClear={clearAll}
          summary={!isLoading && !error ? `${suppliers.length} ${suppliers.length === 1 ? "proveedor" : "proveedores"}` : undefined}
        />

        <EconomyTable
          rows={suppliers as Supplier[]}
          columns={columns}
          rowKey={(s) => s.id}
          caption="Proveedores"
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          errorTitle="No se han podido cargar los proveedores"
          emptyTitle={filtered ? "Ningún proveedor coincide con los filtros" : "Aún no hay proveedores"}
          emptyDescription={filtered ? "Prueba con otra búsqueda o quita los filtros." : "Da de alta a tus proveedores para liquidarles sus ventas y comisiones."}
          emptyAction={filtered ? <Button variant="outline" size="sm" onClick={clearAll}>Limpiar filtros</Button> : <Button size="sm" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nuevo proveedor</Button>}
          onRowClick={(s) => setSelected(s)}
          actions={(s) => (
            <RowActions
              label={s.commercialName || s.fiscalName}
              primary={{ label: "Ver ficha", icon: <Eye className="h-3.5 w-3.5" />, onSelect: () => setSelected(s) }}
              menu={[
                { label: "Editar", icon: <Pencil />, onSelect: () => openEdit(s) },
                { label: "Invitar al portal", icon: <Mail />, onSelect: () => inviteSupplier(s), disabled: inviteMutation.isPending },
                { label: "Eliminar", icon: <Trash2 />, destructive: true, onSelect: () => setShowDeleteConfirm(s.id) },
              ]}
            />
          )}
        />
      </div>

      {/* ── Ficha del proveedor ── */}
      <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
          <SheetHeader className="shrink-0 border-b border-border pr-12">
            <SheetTitle className="break-words">{selectedLive ? (selectedLive.commercialName || selectedLive.fiscalName) : "Proveedor"}</SheetTitle>
            <SheetDescription>{selectedLive?.commercialName ? selectedLive.fiscalName : "Ficha del proveedor"}</SheetDescription>
          </SheetHeader>
          {selectedLive && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SupplierStatus status={selectedLive.status} />
                <PaymentBadge method={selectedLive.paymentMethod} />
                <StatusBadge tone="neutral" icon={<Percent />}>{selectedLive.standardCommissionPercent}% comisión estándar</StatusBadge>
                <FreqBadge freq={selectedLive.settlementFrequency ?? "manual"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(selectedLive)}><Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Editar</Button>
                <Button
                  variant="outline" size="sm"
                  disabled={inviteMutation.isPending}
                  onClick={() => inviteSupplier(selectedLive)}
                  title="Crear/invitar usuario del proveedor para acceder a su portal"
                >
                  <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Invitar al portal
                </Button>
                <Button variant="outline" size="sm" className="text-danger hover:text-danger" onClick={() => setShowDeleteConfirm(selectedLive.id)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Eliminar
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <InfoBlock icon={<Landmark />} title="Datos fiscales">
                  <div className="divide-y divide-border">
                    <InfoRow label="NIF/CIF">{selectedLive.nif ?? "—"}</InfoRow>
                    <InfoRow label="Dirección fiscal">{selectedLive.fiscalAddress ?? "—"}</InfoRow>
                    <InfoRow label="IBAN"><span className="font-mono text-xs">{selectedLive.iban ?? "—"}</span></InfoRow>
                    <InfoRow label="Forma de pago"><PaymentBadge method={selectedLive.paymentMethod} /></InfoRow>
                  </div>
                </InfoBlock>
                <InfoBlock icon={<User />} title="Contacto">
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2"><User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-words">{selectedLive.contactPerson ?? "—"}</span></div>
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {selectedLive.adminEmail ? <a href={`mailto:${selectedLive.adminEmail}`} className="break-all text-primary hover:underline">{selectedLive.adminEmail}</a> : <span>—</span>}
                    </div>
                    <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span>{selectedLive.phone ?? "—"}</span></div>
                  </div>
                </InfoBlock>
              </div>

              <SettlementPeriodsPanel supplier={selectedLive} />

              <InfoBlock icon={<Package />} title="Productos vinculados" aside={<Badge variant="secondary">{products.length}</Badge>}>
                {products.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">No hay productos vinculados a este proveedor</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {products.map((p: any) => (
                      <li key={`${p.type}-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <div className="min-w-0">
                          <span className="break-words text-sm font-medium text-foreground">{p.title}</span>
                          <Badge variant="outline" className="ml-2 text-xs">{p.type === "experience" ? "Experiencia" : "Pack"}</Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span>{costTypeLabel[p.supplierCostType ?? "comision_sobre_venta"]}</span>
                          <span className="font-medium text-foreground">{p.supplierCommissionPercent ?? "0"}%</span>
                          <StatusBadge tone={p.isSettlable ? "success" : "neutral"}>{p.isSettlable ? "Liquidable" : "No liquidable"}</StatusBadge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </InfoBlock>

              {selectedLive.internalNotes && (
                <InfoBlock icon={<StickyNote />} title="Notas internas">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{selectedLive.internalNotes}</p>
                </InfoBlock>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Create/Edit modal ── */}
      <Dialog open={showForm} onOpenChange={(v) => { if (!v) { setShowForm(false); setEditingId(null); setForm(defaultForm); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormSection title="Datos fiscales">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Razón social / Nombre fiscal" required className="sm:col-span-2">
                  <Input value={form.fiscalName} onChange={(e) => setForm({ ...form, fiscalName: e.target.value })} placeholder="Empresa S.L." />
                </FormField>
                <FormField label="Nombre comercial">
                  <Input value={form.commercialName} onChange={(e) => setForm({ ...form, commercialName: e.target.value })} placeholder="Nombre visible" />
                </FormField>
                <FormField label="NIF / CIF">
                  <Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} placeholder="B12345678" />
                </FormField>
                <FormField label="Dirección fiscal" className="sm:col-span-2">
                  <Input value={form.fiscalAddress} onChange={(e) => setForm({ ...form, fiscalAddress: e.target.value })} placeholder="Calle, número, ciudad, CP" />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Contacto">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Persona de contacto">
                  <Input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} placeholder="Nombre y apellidos" />
                </FormField>
                <FormField label="Teléfono">
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+34 600 000 000" />
                </FormField>
                <FormField label="Email de administración" className="sm:col-span-2">
                  <Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} placeholder="admin@proveedor.com" />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Datos bancarios y comisión">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="IBAN" className="sm:col-span-2">
                  <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} placeholder="ES00 0000 0000 0000 0000 0000" className="font-mono" />
                </FormField>
                <FormField label="Forma de pago">
                  <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v as SupplierForm["paymentMethod"] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="transferencia">Transferencia bancaria</SelectItem>
                      <SelectItem value="confirming">Confirming</SelectItem>
                      <SelectItem value="efectivo">Efectivo</SelectItem>
                      <SelectItem value="compensacion">Compensación</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Comisión estándar (%)">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.standardCommissionPercent}
                    onChange={(e) => setForm({ ...form, standardCommissionPercent: parseFloat(e.target.value) || 0 })}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection title="Configuración de liquidaciones" description="Cada cuánto se liquida a este proveedor y si los borradores se crean solos.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Periodicidad de liquidación">
                  <Select
                    value={form.settlementFrequency}
                    onValueChange={(v) => setForm({ ...form, settlementFrequency: v as SupplierForm["settlementFrequency"] })}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual (sin automatización)</SelectItem>
                      <SelectItem value="quincenal">Quincenal (cada 15 días)</SelectItem>
                      <SelectItem value="mensual">Mensual</SelectItem>
                      <SelectItem value="trimestral">Trimestral (cada 3 meses)</SelectItem>
                      <SelectItem value="semestral">Semestral (cada 6 meses)</SelectItem>
                      <SelectItem value="anual">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                {form.settlementFrequency !== "manual" && form.settlementFrequency !== "quincenal" && (
                  <FormField label="Día del mes para liquidar" hint="Día en que se genera la liquidación del periodo anterior">
                    <Input
                      type="number"
                      min={1}
                      max={28}
                      value={form.settlementDayOfMonth}
                      onChange={(e) => setForm({ ...form, settlementDayOfMonth: parseInt(e.target.value) || 1 })}
                      placeholder="1-28"
                    />
                  </FormField>
                )}
              </div>
              {form.settlementFrequency !== "manual" && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Auto-generación de liquidaciones</p>
                    <p className="text-xs text-muted-foreground">Crear automáticamente borradores de liquidación al inicio de cada periodo</p>
                  </div>
                  <Switch
                    checked={form.autoGenerateSettlements}
                    onCheckedChange={(v) => setForm({ ...form, autoGenerateSettlements: v })}
                    aria-label="Auto-generación de liquidaciones"
                  />
                </div>
              )}
            </FormSection>

            <FormSection title="Estado y notas">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Estado">
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as SupplierForm["status"] })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="activo">Activo</SelectItem>
                      <SelectItem value="inactivo">Inactivo</SelectItem>
                      <SelectItem value="bloqueado">Bloqueado</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
              <FormField label="Notas internas">
                <Textarea value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} rows={3} placeholder="Condiciones especiales, acuerdos, etc." />
              </FormField>
            </FormSection>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setForm(defaultForm); }}>Cancelar</Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.fiscalName || createMutation.isPending || updateMutation.isPending}
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
          <p className="text-sm text-muted-foreground">Esta acción no se puede deshacer. Las liquidaciones asociadas quedarán sin proveedor vinculado.</p>
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
    </AdminLayout>
  );
}
