import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  FileText, Plus, Search, ChevronRight, Calendar, Euro, CheckCircle2,
  Clock, AlertTriangle, XCircle, RefreshCw, Send, Trash2, ExternalLink,
  Download, Upload, FileCheck, History, Building2, Calculator, Paperclip,
  FileSpreadsheet
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
  source?: "invoice" | "tpv_reservation";
};

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  emitida: { label: "Emitida", color: "bg-blue-100 text-blue-800 border-blue-200", icon: FileText },
  pendiente_abono: { label: "Pendiente abono", color: "bg-amber-100 text-amber-800 border-amber-200", icon: Clock },
  abonada: { label: "Abonada", color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2 },
  incidencia: { label: "Incidencia", color: "bg-red-100 text-red-700 border-red-200", icon: AlertTriangle },
  recalculada: { label: "Recalculada", color: "bg-purple-100 text-purple-800 border-purple-200", icon: RefreshCw },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "bg-slate-100 text-slate-600", icon: FileText };
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.color} border text-xs`}>
      <Icon className="w-3 h-3 mr-1" />
      {cfg.label}
    </Badge>
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

  const { data: settlements = [], isLoading } = trpc.settlements.list.useQuery({
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

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

  return (
    <div className="flex h-full min-h-screen bg-slate-50">
      {/* ── Left panel: list ── */}
      <div className="w-80 flex-shrink-0 border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600" />
              Liquidaciones
            </h2>
            <Button size="sm" onClick={() => setShowCreate(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
              <Plus className="w-3 h-3 mr-1" />Nueva
            </Button>
          </div>
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="emitida">Emitida</SelectItem>
              <SelectItem value="pendiente_abono">Pendiente abono</SelectItem>
              <SelectItem value="abonada">Abonada</SelectItem>
              <SelectItem value="incidencia">Incidencia</SelectItem>
              <SelectItem value="recalculada">Recalculada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-slate-400">Cargando...</div>
          ) : filteredSettlements.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No hay liquidaciones
            </div>
          ) : (
            filteredSettlements.map((s: any) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`w-full text-left px-4 py-3 border-b hover:bg-slate-50 transition-colors ${selected?.id === s.id ? "bg-indigo-50 border-l-2 border-l-indigo-500" : ""}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs font-semibold text-slate-700">{s.settlementNumber}</span>
                  <StatusBadge status={s.status} />
                </div>
                <div className="text-xs text-slate-600 truncate">{s.supplierName ?? "—"}</div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-slate-400">{s.periodFrom} → {s.periodTo}</span>
                  <span className="text-xs font-semibold text-slate-700">{fmt(s.netAmountProvider)} €</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel: detail ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <FileText className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">Selecciona una liquidación</p>
            <p className="text-sm">o crea una nueva con el botón "Nueva"</p>
          </div>
        ) : (
          <div className="max-w-4xl space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold font-mono text-slate-900">{detail?.settlementNumber}</h1>
                <p className="text-sm text-slate-500 mt-1">
                  <Building2 className="w-3 h-3 inline mr-1" />
                  {detail?.supplierName ?? "—"} · Periodo: {detail?.periodFrom} — {detail?.periodTo}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <StatusBadge status={detail?.status ?? "emitida"} />
                  {detail?.sentAt && <Badge variant="outline" className="text-xs"><Send className="w-3 h-3 mr-1" />Enviada</Badge>}
                  {detail?.paidAt && <Badge variant="outline" className="text-xs text-emerald-700"><CheckCircle2 className="w-3 h-3 mr-1" />Abonada</Badge>}
                </div>
              </div>
              <div className="flex gap-2 flex-wrap justify-end">
                <Button
                  variant="outline" size="sm"
                  onClick={() => selected && recalculateMutation.mutate({ id: selected.id })}
                  disabled={recalculateMutation.isPending}
                  className="text-amber-700 border-amber-200 hover:bg-amber-50"
                  title="Regenerar líneas desde reservas TPV y facturas del periodo"
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${recalculateMutation.isPending ? 'animate-spin' : ''}`} />
                  {recalculateMutation.isPending ? "Recalculando..." : "Recalcular"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowStatusChange(true)}>
                  <RefreshCw className="w-3 h-3 mr-1" />Estado
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowSendEmail(true)}>
                  <Send className="w-3 h-3 mr-1" />Enviar email
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => selected && generatePdfMutation.mutate({ id: selected.id })}
                  disabled={generatePdfMutation.isPending}
                  className="text-violet-700 border-violet-200 hover:bg-violet-50"
                >
                  <FileText className="w-3 h-3 mr-1" />
                  {generatePdfMutation.isPending ? "Generando..." : "Generar PDF"}
                </Button>
                {detail?.pdfUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.pdfUrl} target="_blank" rel="noopener noreferrer">
                      <Download className="w-3 h-3 mr-1" />Descargar PDF
                    </a>
                  </Button>
                )}
                {selected && (
                  <Button variant="outline" size="sm" asChild className="text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                    <a
                      href={`/api/settlements/${selected.id}/export-excel`}
                      download
                    >
                      <FileSpreadsheet className="w-3 h-3 mr-1" />Exportar Excel
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => { if (confirm("¿Eliminar liquidación?")) deleteMutation.mutate({ id: selected.id }); }}>
                  <Trash2 className="w-3 h-3 mr-1" />Eliminar
                </Button>
              </div>
            </div>

            {/* Totales */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Importe bruto", value: fmt(detail?.grossAmount), color: "text-slate-800" },
                { label: "Comisión agencia", value: fmt(detail?.commissionAmount), color: "text-orange-600" },
                { label: "Neto proveedor", value: fmt(detail?.netAmountProvider), color: "text-emerald-700 font-bold" },
              ].map((t) => (
                <Card key={t.label}>
                  <CardContent className="pt-4 pb-3">
                    <p className="text-xs text-slate-500">{t.label}</p>
                    <p className={`text-2xl font-bold ${t.color}`}>{t.value} €</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Líneas */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-indigo-500" />
                  Líneas de liquidación
                  <Badge variant="secondary" className="ml-auto">{(detail as any)?.lines?.length ?? 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!(detail as any)?.lines?.length ? (
                  <p className="text-sm text-slate-400 text-center py-3">Sin líneas</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-slate-500">
                          <th className="text-left py-2 pr-3">Producto / Servicio</th>
                          <th className="text-center py-2 px-2">Fecha</th>
                          <th className="text-center py-2 px-2">Pax</th>
                          <th className="text-right py-2 px-2">Venta</th>
                          <th className="text-right py-2 px-2">Comisión</th>
                          <th className="text-right py-2 pl-2">Neto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail as any).lines.map((l: SettlementLine) => (
                          <tr key={l.id} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="py-2 pr-3 font-medium text-slate-800">{l.productName ?? "—"}</td>
                            <td className="py-2 px-2 text-center text-slate-500">{l.serviceDate ?? "—"}</td>
                            <td className="py-2 px-2 text-center">{l.paxCount}</td>
                            <td className="py-2 px-2 text-right">{fmt(l.saleAmount)} €</td>
                            <td className="py-2 px-2 text-right text-orange-600">{fmt(l.commissionAmount)} € ({fmt(l.commissionPercent)}%)</td>
                            <td className="py-2 pl-2 text-right font-semibold text-emerald-700">{fmt(l.netAmountProvider)} €</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Documentos */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-indigo-500" />
                    Documentos adjuntos
                    <Badge variant="secondary">{(detail as any)?.docs?.length ?? 0}</Badge>
                  </CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setShowAddDoc(true)}>
                    <Plus className="w-3 h-3 mr-1" />Añadir
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!(detail as any)?.docs?.length ? (
                  <p className="text-sm text-slate-400 text-center py-3">Sin documentos adjuntos</p>
                ) : (
                  <div className="space-y-2">
                    {(detail as any).docs.map((d: SettlementDoc) => (
                      <div key={d.id} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center gap-2">
                          <FileCheck className="w-4 h-4 text-indigo-400" />
                          <div>
                            <span className="text-sm font-medium text-slate-800">{d.title}</span>
                            <Badge variant="outline" className="ml-2 text-xs">{docTypeLabel[d.docType] ?? d.docType}</Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.fileUrl && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={d.fileUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                            onClick={() => deleteDocMutation.mutate({ id: d.id })}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Historial de estados */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <History className="w-4 h-4 text-indigo-500" />
                  Historial de estados
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!(detail as any)?.statusHistory?.length ? (
                  <p className="text-sm text-slate-400 text-center py-3">Sin historial</p>
                ) : (
                  <div className="space-y-2">
                    {(detail as any).statusHistory.map((h: StatusHistory) => (
                      <div key={h.id} className="flex items-start gap-3 py-2 border-b last:border-0 text-sm">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {h.fromStatus && <StatusBadge status={h.fromStatus} />}
                            {h.fromStatus && <ChevronRight className="w-3 h-3 text-slate-400" />}
                            <StatusBadge status={h.toStatus} />
                            <span className="text-xs text-slate-400 ml-auto">{new Date(h.createdAt).toLocaleString("es-ES")}</span>
                          </div>
                          {h.notes && <p className="text-xs text-slate-500 mt-1">{h.notes}</p>}
                          <p className="text-xs text-slate-400">Por: {h.changedByName}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── Create settlement modal ── */}
      <Dialog open={showCreate} onOpenChange={(v) => { if (!v) { setShowCreate(false); setManualLines([]); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-indigo-600" />
              Nueva liquidación de proveedor
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-3">
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

            {/* Auto-calculated lines preview */}
            {createForm.supplierId > 0 && createForm.periodFrom && createForm.periodTo && (
              <div>
                <Separator className="my-3" />
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-2">
                  <Calculator className="w-3 h-3" />
                  Líneas calculadas automáticamente
                  {previewLoading && <span className="text-slate-400 font-normal">(calculando...)</span>}
                </p>
                {preview?.lines?.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No se encontraron facturas cobradas en el periodo para los productos de este proveedor.</p>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr className="border-b text-slate-500">
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
                            <td className="py-2 px-2 text-right text-orange-600">{l.commissionAmount.toFixed(2)} € ({l.commissionPercent}%)</td>
                            <td className="py-2 px-2 text-right font-semibold text-emerald-700">{l.netAmountProvider.toFixed(2)} €</td>
                          </tr>
                        ))}
                      </tbody>
                      {preview && (
                        <tfoot className="bg-slate-50 font-semibold">
                          <tr>
                            <td className="py-2 px-3 text-slate-700">TOTAL</td>
                            <td className="py-2 px-2 text-right">{preview.totals.grossAmount.toFixed(2)} €</td>
                            <td className="py-2 px-2 text-right text-orange-600">{preview.totals.commissionAmount.toFixed(2)} €</td>
                            <td className="py-2 px-2 text-right text-emerald-700">{preview.totals.netAmountProvider.toFixed(2)} €</td>
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
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Líneas manuales adicionales</p>
                <Button size="sm" variant="outline" onClick={addManualLine}>
                  <Plus className="w-3 h-3 mr-1" />Añadir línea
                </Button>
              </div>
              {manualLines.map((l, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 mb-2 p-3 border rounded-lg bg-slate-50">
                  <div className="col-span-2">
                    <Input placeholder="Nombre del servicio" value={l.productName} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].productName = e.target.value; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Input type="number" placeholder="Importe venta" value={l.saleAmount || ""} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].saleAmount = parseFloat(e.target.value) || 0; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Input type="number" placeholder="% Comisión" value={l.commissionPercent || ""} onChange={(e) => {
                      const nl = [...manualLines]; nl[i].commissionPercent = parseFloat(e.target.value) || 0; setManualLines(nl);
                    }} className="h-8 text-xs" />
                  </div>
                  <Button size="sm" variant="ghost" className="text-red-500 h-8" onClick={() => setManualLines(manualLines.filter((_, j) => j !== i))}>
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
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
            <p className="text-sm text-slate-600">
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
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {sendEmailMutation.isPending ? "Enviando..." : "Enviar email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
