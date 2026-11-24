import { useState, type ReactNode } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader, PanelDataList, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "@/pages/admin/accounting/shared/EconomyUi";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FileText, Plus, Search, ChevronRight, Calendar, Euro, CheckCircle2,
  Clock, AlertTriangle, XCircle, RefreshCw, Send, Trash2, ExternalLink,
  Download, Upload, FileCheck, History, Building2, Calculator, Paperclip,
  FileSpreadsheet, Eye
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SettlementLine = {
  id: number;
  productName?: string | null;
  serviceDate?: string | null;
  paxCount: number;
  saleAmount: string;
  commissionPercent: string;
  commissionAmount: string;
  netAmountProvider: string;
  costType: string;
  notes?: string | null;
};

type SettlementDoc = {
  id: number;
  docType: string;
  title: string;
  fileUrl?: string | null;
  notes?: string | null;
  createdAt: Date;
};

type StatusHistory = {
  id: number;
  fromStatus?: string | null;
  toStatus: string;
  changedByName: string;
  notes?: string | null;
  createdAt: Date;
};

type Settlement = {
  id: number;
  settlementNumber: string;
  supplierId: number;
  supplierName?: string | null;
  supplierNif?: string | null;
  supplierIban?: string | null;
  supplierEmail?: string | null;
  periodFrom: string;
  periodTo: string;
  grossAmount: string;
  commissionAmount: string;
  netAmountProvider: string;
  status: string;
  pdfUrl?: string | null;
  sentAt?: Date | null;
  paidAt?: Date | null;
  internalNotes?: string | null;
  createdAt: Date;
  lines?: SettlementLine[];
  docs?: SettlementDoc[];
  statusHistory?: StatusHistory[];
};

type PreviewLine = {
  reservationId?: number;
  invoiceId?: number;
  productId: number;
  productName: string;
  serviceDate: string;
  paxCount: number;
  saleAmount: number;
  commissionPercent: number;
  commissionAmount: number;
  netAmountProvider: number;
  costType: string;
  source?: "invoice" | "tpv_reservation" | "crm_reservation";
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; tone: Tone; icon: ReactNode }> = {
  emitida: { label: "Emitida", tone: "info", icon: <FileText /> },
  pendiente_abono: { label: "Pendiente abono", tone: "warning", icon: <Clock /> },
  abonada: { label: "Abonada", tone: "success", icon: <CheckCircle2 /> },
  incidencia: { label: "Incidencia", tone: "danger", icon: <AlertTriangle /> },
  recalculada: { label: "Recalculada", tone: "brand", icon: <RefreshCw /> },
};

function StatusBadgeS({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, tone: "neutral" as Tone, icon: <FileText /> };
  return <StatusBadge tone={cfg.tone} icon={cfg.icon}>{cfg.label}</StatusBadge>;
}

/** Bloque de la ficha: título con icono y contenido. */
function DetailBlock({ icon, title, aside, children }: { icon: ReactNode; title: string; aside?: ReactNode; children: ReactNode }) {
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

function fmt(v: string | number | undefined | null): string {
  return parseFloat(String(v ?? "0")).toFixed(2);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SettlementsManager() {

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Settlement | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showStatusChange, setShowStatusChange] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [showSendEmail, setShowSendEmail] = useState(false);
  const [statusChangeNotes, setStatusChangeNotes] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [docForm, setDocForm] = useState({ docType: "factura_recibida" as const, title: "", fileUrl: "", notes: "" });
  const [emailOverride, setEmailOverride] = useState("");

  // Create form state
  const [createForm, setCreateForm] = useState({
    supplierId: 0,
    periodFrom: "",
    periodTo: "",
    internalNotes: "",
  });
  const [previewLines, setPreviewLines] = useState<PreviewLine[]>([]);
  const [previewTotals, setPreviewTotals] = useState({ grossAmount: 0, commissionAmount: 0, netAmountProvider: 0 });
  const [manualLines, setManualLines] = useState<Array<{
    productName: string; serviceDate: string; paxCount: number;
    saleAmount: number; commissionPercent: number; costType: string; notes: string;
  }>>([]);

  const utils = trpc.useUtils();

  const { data: settlements = [], isLoading, error: listError, refetch: refetchList } = trpc.settlements.list.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  // Resumen: la misma lista sin filtrar (solo lectura, para los indicadores)
  const { data: allSettlements = [] } = trpc.settlements.list.useQuery({ status: undefined });

  const { data: selectedDetail, refetch: refetchDetail } = trpc.settlements.get.useQuery(
    { id: selected?.id ?? 0 },
    { enabled: !!selected }
  );

  const { data: suppliers = [] } = trpc.suppliers.list.useQuery({ status: "activo" });

  const { data: preview, isLoading: previewLoading } = trpc.settlements.preview.useQuery(
    { supplierId: createForm.supplierId, periodFrom: createForm.periodFrom, periodTo: createForm.periodTo },
    { enabled: !!createForm.supplierId && !!createForm.periodFrom && !!createForm.periodTo }
  );

  const createMutation = trpc.settlements.create.useMutation({
    onSuccess: (data) => {
      utils.settlements.list.invalidate();
      setShowCreate(false);
      setCreateForm({ supplierId: 0, periodFrom: "", periodTo: "", internalNotes: "" });
      setManualLines([]);
      toast.success(`Liquidación ${data.settlementNumber} creada correctamente`);
    },
    onError: (e) => toast.error(`Error al crear liquidación: ${e.message}`),
  });

  const updateStatusMutation = trpc.settlements.updateStatus.useMutation({
    onSuccess: () => {
      utils.settlements.list.invalidate();
      refetchDetail();
      setShowStatusChange(false);
      setStatusChangeNotes("");
      toast.success("Estado actualizado");
    },
    onError: (e) => toast.error(`Error al actualizar estado: ${e.message}`),
  });

  const addDocMutation = trpc.settlements.addDocument.useMutation({
    onSuccess: () => {
      refetchDetail();
      setShowAddDoc(false);
      setDocForm({ docType: "factura_recibida", title: "", fileUrl: "", notes: "" });
      toast.success("Documento añadido");
    },
    onError: (e) => toast.error(`Error al añadir documento: ${e.message}`),
  });

  const deleteDocMutation = trpc.settlements.deleteDocument.useMutation({
    onSuccess: () => { refetchDetail(); toast.success("Documento eliminado"); },
  });

  const generatePdfMutation = trpc.settlements.generatePdf.useMutation({
    onSuccess: (data) => {
      refetchDetail();
      toast.success("PDF generado correctamente");
      window.open(data.url, "_blank");
    },
    onError: (e) => toast.error(`Error al generar PDF: ${e.message}`),
  });
  const recalculateMutation = trpc.settlements.recalculate.useMutation({
    onSuccess: (data) => {
      utils.settlements.list.invalidate();
      refetchDetail();
      toast.success(`Liquidación recalculada: ${data.linesCount} líneas · ${data.grossAmount.toFixed(2)}€ bruto`);
    },
    onError: (e) => toast.error(`Error al recalcular: ${e.message}`),
  });

  const sendEmailMutation = trpc.settlements.sendEmail.useMutation({
    onSuccess: () => {
      refetchDetail();
      setShowSendEmail(false);
      toast.success("Email enviado al proveedor");
    },
    onError: (e) => toast.error(`Error al enviar email: ${e.message}`),
  });

  const deleteMutation = trpc.settlements.delete.useMutation({
    onSuccess: () => {
      utils.settlements.list.invalidate();
      setSelected(null);
      toast.success("Liquidación eliminada");
    },
  });

  function addManualLine() {
    setManualLines([...manualLines, { productName: "", serviceDate: createForm.periodFrom, paxCount: 1, saleAmount: 0, commissionPercent: 0, costType: "comision_sobre_venta", notes: "" }]);
  }

  function handleCreate() {
    const autoLines = (preview?.lines ?? []).map((l: PreviewLine) => ({
      reservationId: l.reservationId,
      invoiceId: l.invoiceId,
      productId: l.productId,
      productName: l.productName,
      serviceDate: l.serviceDate,
      paxCount: l.paxCount,
      saleAmount: l.saleAmount,
      commissionPercent: l.commissionPercent,
      costType: l.costType as any,
    }));
    const allLines = [
      ...autoLines,
      ...manualLines.map((l) => ({
        productName: l.productName,
        serviceDate: l.serviceDate,
        paxCount: l.paxCount,
        saleAmount: l.saleAmount,
        commissionPercent: l.commissionPercent,
        costType: l.costType as any,
        notes: l.notes,
      })),
    ];
    createMutation.mutate({
      supplierId: createForm.supplierId,
      periodFrom: createForm.periodFrom,
      periodTo: createForm.periodTo,
      lines: allLines,
      internalNotes: createForm.internalNotes,
    });
  }

  const detail = selectedDetail ?? selected;
  const filteredSettlements = settlements.filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.settlementNumber?.toLowerCase().includes(q) ||
      s.supplierName?.toLowerCase().includes(q)
    );
  });

  const docTypeLabel: Record<string, string> = {
    factura_recibida: "Factura recibida",
    contrato: "Contrato",
    justificante_pago: "Justificante de pago",
    email: "Email",
    acuerdo_comision: "Acuerdo comisión",
    otro: "Otro",
  };

  const all = (allSettlements as any[]) as Settlement[];
  const sumNet = (xs: Settlement[]) => xs.reduce((a, s) => a + (parseFloat(String(s.netAmountProvider ?? "0")) || 0), 0);
  const toPay = all.filter((s) => s.status === "emitida" || s.status === "pendiente_abono" || s.status === "recalculada");
  const paid = all.filter((s) => s.status === "abonada");
  const issues = all.filter((s) => s.status === "incidencia");
  const filtered = search.trim() !== "" || statusFilter !== "all";
  const chips: FilterChip[] = [
    ...(search.trim() ? [{ id: "q", label: `Búsqueda: ${search.trim()}`, onRemove: () => setSearch("") }] : []),
    ...(statusFilter !== "all" ? [{ id: "status", label: `Estado: ${STATUS_CONFIG[statusFilter]?.label ?? statusFilter}`, onRemove: () => setStatusFilter("all") }] : []),
  ];
  const clearAll = () => { setSearch(""); setStatusFilter("all"); };

  const columns: EconomyColumn<Settlement>[] = [
    { key: "num", header: "Liquidación", mobile: "title", cell: (s) => (
      <div className="min-w-0">
        <div className="font-mono text-sm font-semibold text-foreground">{s.settlementNumber}</div>
        <div className="break-words text-xs text-muted-foreground">{s.supplierName ?? "—"}</div>
      </div>
    ) },
    { key: "period", header: "Periodo", priority: "md", cell: (s) => <span className="whitespace-nowrap text-xs text-muted-foreground">{s.periodFrom} → {s.periodTo}</span> },
    { key: "status", header: "Estado", cell: (s) => <StatusBadgeS status={s.status} /> },
    { key: "gross", header: "Importe bruto", align: "right", num: true, priority: "lg", cell: (s) => `${fmt(s.grossAmount)} €` },
    { key: "commission", header: "Comisión", align: "right", num: true, priority: "xl", cell: (s) => `${fmt(s.commissionAmount)} €` },
    { key: "net", header: "Neto proveedor", align: "right", num: true, mobile: "amount", cell: (s) => <span className="font-semibold text-foreground">{fmt(s.netAmountProvider)} €</span> },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <PanelPageHeader
          className="mb-0"
          icon={<FileText />}
          title="Liquidaciones de proveedores"
          description="Ventas, comisión de la agencia y neto a abonar a cada proveedor por periodo."
          actions={<Button onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva liquidación</Button>}
        />

        <EconomySummary>
          <MetricCard icon={<Clock />} tone="warning" label="Neto pendiente de abonar" value={`${sumNet(toPay).toFixed(2)} €`} detail={`${toPay.length} ${toPay.length === 1 ? "liquidación" : "liquidaciones"}`} />
          <MetricCard icon={<CheckCircle2 />} tone="success" label="Abonado" value={`${sumNet(paid).toFixed(2)} €`} detail={`${paid.length} ${paid.length === 1 ? "liquidación" : "liquidaciones"}`} onClick={() => setStatusFilter(statusFilter === "abonada" ? "all" : "abonada")} active={statusFilter === "abonada"} />
          <MetricCard icon={<AlertTriangle />} tone={issues.length ? "danger" : "neutral"} label="Con incidencia" value={issues.length} onClick={() => setStatusFilter(statusFilter === "incidencia" ? "all" : "incidencia")} active={statusFilter === "incidencia"} />
          <MetricCard icon={<FileText />} tone="brand" label="Liquidaciones" value={all.length} />
        </EconomySummary>

        <EconomyFilterBar
          search={{ value: search, onChange: setSearch, placeholder: "Buscar por número o proveedor…" }}
          primary={
            <FilterField label="Estado" className="w-full sm:w-52">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  <SelectItem value="emitida">Emitida</SelectItem>
                  <SelectItem value="pendiente_abono">Pendiente abono</SelectItem>
                  <SelectItem value="abonada">Abonada</SelectItem>
                  <SelectItem value="incidencia">Incidencia</SelectItem>
                  <SelectItem value="recalculada">Recalculada</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          }
          chips={chips}
          onClear={clearAll}
          summary={!isLoading && !listError ? `${filteredSettlements.length} ${filteredSettlements.length === 1 ? "liquidación" : "liquidaciones"}` : undefined}
        />

        <EconomyTable
          rows={filteredSettlements as Settlement[]}
          columns={columns}
          rowKey={(s) => s.id}
          caption="Liquidaciones de proveedores"
          loading={isLoading}
          error={listError}
          onRetry={() => refetchList()}
          errorTitle="No se han podido cargar las liquidaciones"
          emptyTitle={filtered ? "Ninguna liquidación coincide con los filtros" : "Aún no hay liquidaciones"}
          emptyDescription={filtered ? "Prueba con otra búsqueda o quita los filtros." : "Crea la primera liquidación eligiendo proveedor y periodo: las líneas se calculan con sus ventas."}
          emptyAction={filtered ? <Button variant="outline" size="sm" onClick={clearAll}>Limpiar filtros</Button> : <Button size="sm" onClick={() => setShowCreate(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva liquidación</Button>}
          onRowClick={(s) => setSelected(s)}
          actions={(s) => (
            <RowActions label={s.settlementNumber} primary={{ label: "Ver detalle", icon: <Eye className="h-3.5 w-3.5" />, onSelect: () => setSelected(s) }} />
          )}
        />
      </div>

      {/* ── Detalle de la liquidación ── */}
      <Sheet open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-3xl">
          <SheetHeader className="shrink-0 border-b border-border pr-12">
            <SheetTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{detail?.settlementNumber}</span>
              <StatusBadgeS status={detail?.status ?? "emitida"} />
            </SheetTitle>
            <SheetDescription>
              <Building2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {detail?.supplierName ?? "—"} · Periodo: {detail?.periodFrom} — {detail?.periodTo}
            </SheetDescription>
          </SheetHeader>
          {selected && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="flex flex-wrap items-center gap-2">
              {detail?.sentAt && <StatusBadge tone="info" icon={<Send />}>Enviada</StatusBadge>}
              {detail?.paidAt && <StatusBadge tone="success" icon={<CheckCircle2 />}>Abonada</StatusBadge>}
            </div>

            {/* Acciones */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline" size="sm"
                onClick={() => selected && recalculateMutation.mutate({ id: selected.id })}
                disabled={recalculateMutation.isPending}
                title="Regenerar líneas desde reservas TPV y facturas del periodo"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${recalculateMutation.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
                {recalculateMutation.isPending ? "Recalculando..." : "Recalcular"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowStatusChange(true)}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Estado
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowSendEmail(true)}>
                <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Enviar email
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => selected && generatePdfMutation.mutate({ id: selected.id })}
                disabled={generatePdfMutation.isPending}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {generatePdfMutation.isPending ? "Generando..." : "Generar PDF"}
              </Button>
              {detail?.pdfUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={detail.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Descargar PDF
                  </a>
                </Button>
              )}
              {selected && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/settlements/${selected.id}/export-excel`} download>
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Exportar Excel
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-danger hover:text-danger"
                onClick={async () => { if ((await confirmAction({ description: "¿Eliminar liquidación?", destructive: true }))) deleteMutation.mutate({ id: selected.id }); }}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Eliminar
              </Button>
            </div>

            {/* Totales */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MetricCard compact icon={<Euro />} tone="neutral" label="Importe bruto" value={`${fmt(detail?.grossAmount)} €`} />
              <MetricCard compact icon={<Calculator />} tone="warning" label="Comisión agencia" value={`${fmt(detail?.commissionAmount)} €`} />
              <MetricCard compact icon={<CheckCircle2 />} tone="success" label="Neto proveedor" value={`${fmt(detail?.netAmountProvider)} €`} />
            </div>

            {/* Líneas */}
            <DetailBlock icon={<Calculator />} title="Líneas de liquidación" aside={<Badge variant="secondary">{(detail as any)?.lines?.length ?? 0}</Badge>}>
              {!(detail as any)?.lines?.length ? (
                <p className="py-2 text-sm text-muted-foreground">Sin líneas</p>
              ) : (
                <PanelDataList<SettlementLine>
                  className="border-0"
                  caption="Líneas de liquidación"
                  rows={(detail as any).lines}
                  rowKey={(l) => l.id}
                  columns={[
                    { key: "p", header: "Producto / Servicio", cell: (l) => <span className="font-medium text-foreground">{l.productName ?? "—"}</span> },
                    { key: "d", header: "Fecha", cell: (l) => <span className="text-muted-foreground">{l.serviceDate ?? "—"}</span> },
                    { key: "x", header: "Pax", align: "right", cell: (l) => l.paxCount },
                    { key: "s", header: "Venta", align: "right", cell: (l) => <span className="tabular-nums">{fmt(l.saleAmount)} €</span> },
                    { key: "c", header: "Comisión", align: "right", cell: (l) => <span className="tabular-nums">{fmt(l.commissionAmount)} € ({fmt(l.commissionPercent)}%)</span> },
                    { key: "n", header: "Neto", align: "right", cell: (l) => <span className="font-semibold tabular-nums text-foreground">{fmt(l.netAmountProvider)} €</span> },
                  ]}
                />
              )}
            </DetailBlock>

            {/* Documentos */}
            <DetailBlock
              icon={<Paperclip />}
              title="Documentos adjuntos"
              aside={<><Badge variant="secondary">{(detail as any)?.docs?.length ?? 0}</Badge><Button size="sm" variant="outline" onClick={() => setShowAddDoc(true)}><Plus className="mr-1 h-3 w-3" aria-hidden="true" />Añadir</Button></>}
            >
              {!(detail as any)?.docs?.length ? (
                <p className="py-2 text-sm text-muted-foreground">Sin documentos adjuntos</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(detail as any).docs.map((d: SettlementDoc) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <FileCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <div className="min-w-0">
                          <span className="break-words text-sm font-medium text-foreground">{d.title}</span>
                          <Badge variant="outline" className="ml-2 text-xs">{docTypeLabel[d.docType] ?? d.docType}</Badge>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {d.fileUrl && (
                          <Button variant="ghost" size="icon" className="h-9 w-9" asChild>
                            <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${d.title}`}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-9 w-9 text-danger hover:text-danger" aria-label={`Eliminar ${d.title}`}
                          onClick={() => deleteDocMutation.mutate({ id: d.id })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>

            {/* Historial de estados */}
            <DetailBlock icon={<History />} title="Historial de estados">
              {!(detail as any)?.statusHistory?.length ? (
                <p className="py-2 text-sm text-muted-foreground">Sin historial</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(detail as any).statusHistory.map((h: StatusHistory) => (
                    <li key={h.id} className="py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {h.fromStatus && <StatusBadgeS status={h.fromStatus} />}
                        {h.fromStatus && <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                        <StatusBadgeS status={h.toStatus} />
                        <span className="ml-auto text-xs text-muted-foreground">{new Date(h.createdAt).toLocaleString("es-ES")}</span>
                      </div>
                      {h.notes && <p className="mt-1 text-xs text-muted-foreground">{h.notes}</p>}
                      <p className="text-xs text-muted-foreground">Por: {h.changedByName}</p>
                    </li>
                  ))}
                </ul>
              )}
            </DetailBlock>
          </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Create settlement modal ── */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setManualLines([]); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-primary" />
              Nueva liquidación de proveedor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormSection title="Proveedor y periodo">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Proveedor *</Label>
                <Select value={String(createForm.supplierId || "")} onValueChange={(v) => setCreateForm({ ...createForm, supplierId: parseInt(v) })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona proveedor..." /></SelectTrigger>
                  <SelectContent>
                    {(suppliers as any[]).map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.commercialName || s.fiscalName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Periodo desde *</Label>
                <Input type="date" value={createForm.periodFrom} onChange={(e) => setCreateForm({ ...createForm, periodFrom: e.target.value })} />
              </div>
              <div>
                <Label>Periodo hasta *</Label>
                <Input type="date" value={createForm.periodTo} onChange={(e) => setCreateForm({ ...createForm, periodTo: e.target.value })} />
              </div>
            </div>
            </FormSection>

            {/* Auto-calculated lines preview */}
            {createForm.supplierId > 0 && createForm.periodFrom && createForm.periodTo && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Calculator className="w-3 h-3" />
                  Líneas calculadas automáticamente
                  {previewLoading && <span className="text-muted-foreground font-normal">(calculando...)</span>}
                </p>
                {preview?.lines?.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">No se encontraron facturas cobradas en el periodo para los productos de este proveedor.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40">
                        <tr className="border-b text-muted-foreground">
                          <th className="text-left py-2 px-3">Producto</th>
                          <th className="text-right py-2 px-2">Venta</th>
                          <th className="text-right py-2 px-2">Comisión</th>
                          <th className="text-right py-2 px-2">Neto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(preview?.lines ?? []).map((l: PreviewLine, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 px-3">{l.productName}</td>
                            <td className="py-2 px-2 text-right">{l.saleAmount.toFixed(2)} €</td>
                            <td className="py-2 px-2 text-right text-warning">{l.commissionAmount.toFixed(2)} € ({l.commissionPercent}%)</td>
                            <td className="py-2 px-2 text-right font-semibold text-success">{l.netAmountProvider.toFixed(2)} €</td>
                          </tr>
                        ))}
                      </tbody>
                      {preview && (
                        <tfoot className="bg-muted/40 font-semibold">
                          <tr>
                            <td className="py-2 px-3 text-foreground">TOTAL</td>
                            <td className="py-2 px-2 text-right">{preview.totals.grossAmount.toFixed(2)} €</td>
                            <td className="py-2 px-2 text-right text-warning">{preview.totals.commissionAmount.toFixed(2)} €</td>
                            <td className="py-2 px-2 text-right text-success">{preview.totals.netAmountProvider.toFixed(2)} €</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Manual lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Líneas manuales adicionales</p>
                <Button size="sm" variant="outline" onClick={addManualLine}>
                  <Plus className="w-3 h-3 mr-1" />Añadir línea
                </Button>
              </div>
              {manualLines.map((l, i) => (
                <div key={i} className="mb-2 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-5">
                  <div className="col-span-2">
                    <Input aria-label="Nombre del servicio" placeholder="Nombre del servicio" value={l.productName} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].productName = e.target.value; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Input type="number" aria-label="Importe de venta" placeholder="Importe venta" value={l.saleAmount || ""} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].saleAmount = parseFloat(e.target.value) || 0; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Input type="number" aria-label="Porcentaje de comisión" placeholder="% Comisión" value={l.commissionPercent || ""} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].commissionPercent = parseFloat(e.target.value) || 0; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <Button size="sm" variant="ghost" aria-label="Quitar línea" className="h-8 text-danger hover:text-danger" onClick={() => setManualLines(manualLines.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>

            <div>
              <Label>Notas internas</Label>
              <Textarea value={createForm.internalNotes} onChange={(e) => setCreateForm({ ...createForm, internalNotes: e.target.value })} rows={2} placeholder="Observaciones para uso interno..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setManualLines([]); }}>Cancelar</Button>
            <Button
              onClick={handleCreate}
              disabled={!createForm.supplierId || !createForm.periodFrom || !createForm.periodTo || createMutation.isPending}
             
            >
              {createMutation.isPending ? "Creando..." : "Crear liquidación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change status modal ── */}
      <Dialog open={showStatusChange} onOpenChange={(v) => { if (!v) { setShowStatusChange(false); setStatusChangeNotes(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cambiar estado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Nuevo estado</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue placeholder="Selecciona estado..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="emitida">Emitida</SelectItem>
                  <SelectItem value="pendiente_abono">Pendiente abono</SelectItem>
                  <SelectItem value="abonada">Abonada</SelectItem>
                  <SelectItem value="incidencia">Incidencia</SelectItem>
                  <SelectItem value="recalculada">Recalculada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notas del cambio</Label>
              <Textarea value={statusChangeNotes} onChange={(e) => setStatusChangeNotes(e.target.value)} rows={2} placeholder="Motivo del cambio..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusChange(false)}>Cancelar</Button>
            <Button
              onClick={() => selected && updateStatusMutation.mutate({ id: selected.id, status: newStatus as any, notes: statusChangeNotes })}
              disabled={!newStatus || updateStatusMutation.isPending}
             
            >
              {updateStatusMutation.isPending ? "Guardando..." : "Cambiar estado"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add document modal ── */}
      <Dialog open={showAddDoc} onOpenChange={(v) => { if (!v) setShowAddDoc(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Añadir documento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Tipo de documento</Label>
              <Select value={docForm.docType} onValueChange={(v) => setDocForm({ ...docForm, docType: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="factura_recibida">Factura recibida</SelectItem>
                  <SelectItem value="contrato">Contrato</SelectItem>
                  <SelectItem value="justificante_pago">Justificante de pago</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="acuerdo_comision">Acuerdo comisión</SelectItem>
                  <SelectItem value="otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Título *</Label>
              <Input value={docForm.title} onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} placeholder="Nombre del documento" />
            </div>
            <div>
              <Label>URL del archivo</Label>
              <Input value={docForm.fileUrl} onChange={(e) => setDocForm({ ...docForm, fileUrl: e.target.value })} placeholder="https://..." />
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={docForm.notes} onChange={(e) => setDocForm({ ...docForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDoc(false)}>Cancelar</Button>
            <Button
              onClick={() => selected && addDocMutation.mutate({ settlementId: selected.id, ...docForm, fileUrl: docForm.fileUrl || undefined, notes: docForm.notes || undefined })}
              disabled={!docForm.title || addDocMutation.isPending}
             
            >
              {addDocMutation.isPending ? "Añadiendo..." : "Añadir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Send email modal ── */}
      <Dialog open={showSendEmail} onOpenChange={(v) => { if (!v) setShowSendEmail(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Enviar liquidación por email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Se enviará la liquidación <strong>{detail?.settlementNumber}</strong> al proveedor <strong>{detail?.supplierName}</strong>.
            </p>
            <div>
              <Label>Email (dejar vacío para usar el del proveedor)</Label>
              <Input
                type="email"
                value={emailOverride}
                onChange={(e) => setEmailOverride(e.target.value)}
                placeholder={detail?.supplierEmail ?? "email@proveedor.com"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendEmail(false)}>Cancelar</Button>
            <Button
              onClick={() => selected && sendEmailMutation.mutate({ id: selected.id, emailOverride: emailOverride || undefined })}
              disabled={sendEmailMutation.isPending}
             
            >
              {sendEmailMutation.isPending ? "Enviando..." : "Enviar email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
