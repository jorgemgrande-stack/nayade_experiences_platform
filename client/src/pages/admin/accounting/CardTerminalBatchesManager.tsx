import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Package,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Ban,
  RefreshCw,
  Unlink,
  Link2,
  Trash2,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Play,
  ThumbsUp,
  ThumbsDown,
  Zap,
  X,
  FileCheck,
} from "lucide-react";

type BatchStatus = "pending" | "suggested" | "auto_ready" | "reconciled" | "difference" | "ignored" | "review_required";

const STATUS_LABELS: Record<BatchStatus, string> = {
  pending: "Pendiente",
  suggested: "Sugerido",
  auto_ready: "Listo auto",
  reconciled: "Conciliada",
  difference: "Con diferencia",
  ignored: "Ignorada",
  review_required: "Revisar",
};

const STATUS_TONES: Record<BatchStatus, Tone> = {
  pending: "warning",
  suggested: "info",
  auto_ready: "success",
  reconciled: "success",
  difference: "warning",
  ignored: "neutral",
  review_required: "danger",
};

function scoreIcon(score: number | null | undefined): string {
  if (score == null) return "";
  if (score >= 80) return "🟢";
  if (score >= 50) return "🟡";
  return "🔴";
}

function fmt(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return s;
  }
}

function toneOf(color: string): Tone {
  if (color.includes("success")) return "success";
  if (color.includes("warning")) return "warning";
  if (color.includes("danger")) return "danger";
  if (color.includes("info")) return "info";
  if (color.includes("primary")) return "brand";
  return "neutral";
}

export default function CardTerminalBatchesManager() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<BatchStatus | "">("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genFrom, setGenFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [genTo, setGenTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [recOpen, setRecOpen] = useState(false);
  const [recBmId, setRecBmId] = useState<number | null>(null);
  const [recNotes, setRecNotes] = useState("");

  const [ignOpen, setIgnOpen] = useState(false);
  const [ignNotes, setIgnNotes] = useState("");

  const [delOpOpen, setDelOpOpen] = useState(false);
  const [delOpTarget, setDelOpTarget] = useState<{ batchOpId: number; operationNumber: string | null; amount: string } | null>(null);

  const [justifyOpen, setJustifyOpen] = useState(false);
  const [justifyText, setJustifyText] = useState("");

  const utils = trpc.useUtils();

  const listQ = trpc.cardTerminalBatches.list.useQuery({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    status: statusFilter || undefined,
    limit: 100,
  });

  const detailQ = trpc.cardTerminalBatches.getById.useQuery(
    { id: selectedId! },
    { enabled: selectedId != null }
  );

  const suggestQ = trpc.cardTerminalBatches.suggestBankMovements.useQuery(
    { batchId: selectedId! },
    {
      enabled:
        selectedId != null &&
        !!detailQ.data &&
        !["reconciled", "difference", "ignored"].includes(detailQ.data?.status ?? ""),
    }
  );

  function invalidateAll() {
    utils.cardTerminalBatches.list.invalidate();
    if (selectedId) utils.cardTerminalBatches.getById.invalidate({ id: selectedId });
  }

  const generateMut = trpc.cardTerminalBatches.generate.useMutation({
    onSuccess: (res) => {
      toast.success(`${res.batchesCreated} remesa(s) generada(s) con ${res.operationsIncluded} operación(es)`);
      setGenOpen(false);
      utils.cardTerminalBatches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const runMatchingMut = trpc.cardTerminalBatches.runMatching.useMutation({
    onSuccess: (res) => {
      toast.success(
        `Matching ejecutado: ${res.processed} remesas · ${res.suggested} sugeridas · ${res.autoReady} listas · ${res.autoReconciled} auto-conciliadas`
      );
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const acceptMut = trpc.cardTerminalBatches.acceptSuggestion.useMutation({
    onSuccess: (res) => {
      if (res.hasDifference) {
        toast.warning(`Conciliada con diferencia de ${res.differenceAmount?.toFixed(2)} €`);
      } else {
        toast.success("Sugerencia aceptada — remesa conciliada");
      }
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const rejectMut = trpc.cardTerminalBatches.rejectSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Sugerencia rechazada");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const reconcileMut = trpc.cardTerminalBatches.reconcile.useMutation({
    onSuccess: (res) => {
      if (res.hasDifference) {
        toast.warning(`Conciliada con diferencia de ${res.differenceAmount?.toFixed(2)} €`);
      } else {
        toast.success("Remesa conciliada correctamente");
      }
      setRecOpen(false);
      setRecBmId(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const unreconcileMut = trpc.cardTerminalBatches.unreconcile.useMutation({
    onSuccess: () => {
      toast.success("Conciliación deshecha");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const ignoreMut = trpc.cardTerminalBatches.markIgnored.useMutation({
    onSuccess: () => {
      toast.success("Remesa marcada como ignorada");
      setIgnOpen(false);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.cardTerminalBatches.deleteBatch.useMutation({
    onSuccess: () => {
      toast.success("Remesa eliminada");
      setSelectedId(null);
      utils.cardTerminalBatches.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const removeOpMut = trpc.cardTerminalBatches.removeOperation.useMutation({
    onSuccess: (res) => {
      toast.success(`Operación eliminada. Nuevo neto: ${res.newTotalNet.toFixed(2)} € · ${res.remainingOps} operaciones restantes`);
      setDelOpOpen(false);
      setDelOpTarget(null);
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const justifyMut = trpc.cardTerminalBatches.justifyDifference.useMutation({
    onSuccess: () => {
      toast.success("Diferencia justificada — remesa marcada como conciliada");
      setJustifyOpen(false);
      setJustifyText("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  const batches = listQ.data ?? [];
  const detail = detailQ.data ?? null;
  const suggestions = suggestQ.data ?? [];

  const stats = {
    total: batches.length,
    pending: batches.filter(b => ["pending", "review_required"].includes(b.status)).length,
    needsAction: batches.filter(b => ["suggested", "auto_ready"].includes(b.status)).length,
    reconciled: batches.filter(b => ["reconciled", "difference"].includes(b.status)).length,
  };

  const isSuggested = (s: string) => s === "suggested" || s === "auto_ready";
  const isReconciled = (s: string) => s === "reconciled" || s === "difference";

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <PanelPageHeader
          icon={<Package />}
          title="Remesas TPV"
          description="Agrupa operaciones TPV diarias y concília con movimientos bancarios"
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => runMatchingMut.mutate()}
                disabled={runMatchingMut.isPending}
                className="border-border text-foreground hover:text-foreground text-sm"
              >
                <Play className="w-4 h-4 mr-2" />
                {runMatchingMut.isPending ? "Ejecutando..." : "Ejecutar matching"}
              </Button>
              <Button onClick={() => setGenOpen(true)}>
                <Package className="w-4 h-4 mr-2" />
                Generar remesas
              </Button>
            </>
          }
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total", value: stats.total, icon: Package, color: "text-foreground" },
            { label: "Pendientes", value: stats.pending, icon: Clock, color: "text-warning" },
            { label: "Acción requerida", value: stats.needsAction, icon: Zap, color: "text-info" },
            { label: "Conciliadas", value: stats.reconciled, icon: CheckCircle2, color: "text-success" },
          ].map(s => (
            <MetricCard key={s.label} icon={<s.icon />} tone={toneOf(s.color)} label={s.label} value={s.value} />
          ))}
        </div>

        {/* Filters */}
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Desde</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="bg-muted border-border text-foreground w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Hasta</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="bg-muted border-border text-foreground w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Estado</Label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as BatchStatus | "")}
                  className="bg-muted border border-border text-foreground text-sm rounded-md px-3 py-2 h-10"
                >
                  <option value="">Todos</option>
                  {(Object.keys(STATUS_LABELS) as BatchStatus[]).map(s => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => utils.cardTerminalBatches.list.invalidate()}
                className="border-border text-foreground hover:text-foreground"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Main content: list + detail */}
        <div className="flex gap-4">
          {/* Batch list */}
          <div className="flex-1 min-w-0">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">
                  {batches.length} remesa(s)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {listQ.isLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">Cargando...</div>
                ) : batches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Package className="w-8 h-8" />
                    <span className="text-sm">No hay remesas en este período</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGenOpen(true)}
                      className="mt-2 border-border text-foreground"
                    >
                      Generar remesas
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {batches.map(batch => (
                      <button
                        key={batch.id}
                        onClick={() => setSelectedId(batch.id === selectedId ? null : batch.id)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors ${
                          selectedId === batch.id ? "bg-muted/70" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-foreground">{fmtDate(batch.batchDate)}</span>
                            <StatusBadge tone={STATUS_TONES[batch.status as BatchStatus] ?? "neutral"}>
                              {STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
                            </StatusBadge>
                            {batch.suggestedScore != null && (
                              <span className="text-xs text-muted-foreground">
                                {scoreIcon(batch.suggestedScore)} {batch.suggestedScore}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>Terminal: {batch.terminalCode ?? "—"}</span>
                            <span>{batch.operationCount} ops</span>
                            {batch.differenceAmount && (
                              <span className="text-warning">Δ {fmt(batch.differenceAmount)}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-success">{fmt(batch.totalNet)}</div>
                          <div className="text-xs text-muted-foreground">neto</div>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${selectedId === batch.id ? "rotate-90" : ""}`} />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Detail panel */}
          {selectedId && detail && (
            <div className="w-[420px] shrink-0 flex flex-col gap-3">
              {/* Batch header */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base text-foreground">
                        Remesa {fmtDate(detail.batchDate)}
                      </CardTitle>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Terminal {detail.terminalCode ?? "—"} · Comercio {detail.commerceCode ?? "—"}
                      </div>
                    </div>
                    <StatusBadge tone={STATUS_TONES[detail.status as BatchStatus] ?? "neutral"}>
                      {STATUS_LABELS[detail.status as BatchStatus] ?? detail.status}
                    </StatusBadge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-muted/60 rounded p-2">
                      <div className="text-success font-semibold text-sm">{fmt(detail.totalSales)}</div>
                      <div className="text-xs text-muted-foreground">Ventas</div>
                    </div>
                    <div className="bg-muted/60 rounded p-2">
                      <div className="text-danger font-semibold text-sm">{fmt(detail.totalRefunds)}</div>
                      <div className="text-xs text-muted-foreground">Devol.</div>
                    </div>
                    <div className="bg-muted/60 rounded p-2">
                      <div className="text-foreground font-bold text-sm">{fmt(detail.totalNet)}</div>
                      <div className="text-xs text-muted-foreground">Neto</div>
                    </div>
                  </div>

                  {detail.differenceAmount && (
                    <div className="bg-warning/10 border border-warning/30 rounded p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                        <span className="text-xs text-warning">
                          Diferencia con banco: {fmt(detail.differenceAmount)}
                        </span>
                      </div>
                      {detail.notes && (
                        <div className="text-xs text-muted-foreground italic border-t border-warning/20 pt-2">
                          Justificación: {detail.notes}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Suggested bank movement (auto-matching) */}
                  {isSuggested(detail.status) && detail.suggestedBankMovementId && (
                    <div className="bg-info/10 border border-info/30 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-info font-medium">
                          {scoreIcon(detail.suggestedScore)} Match automático · Score {detail.suggestedScore}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Mov. bancario ID: <span className="text-foreground">{detail.suggestedBankMovementId}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => acceptMut.mutate({ batchId: selectedId })}
                          disabled={acceptMut.isPending}
                          className="flex-1 text-xs h-7"
                        >
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rejectMut.mutate({ batchId: selectedId })}
                          disabled={rejectMut.isPending}
                          className="flex-1 border-danger/50 text-danger hover:text-danger text-xs h-7"
                        >
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          Rechazar
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Review required alert */}
                  {detail.status === "review_required" && (
                    <div className="bg-danger/10 border border-danger/30 rounded p-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
                      <span className="text-xs text-danger">
                        Sin movimiento bancario coincidente. Concilia manualmente.
                      </span>
                    </div>
                  )}

                  {/* Bank movement linked */}
                  {detail.bankMovement && (
                    <div className="bg-success/10 border border-success/30 rounded p-2">
                      <div className="text-xs text-success font-medium mb-1">Movimiento bancario vinculado</div>
                      <div className="text-xs text-foreground">
                        {detail.bankMovement.fecha} · {fmt(detail.bankMovement.importe)}
                      </div>
                      <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                        {detail.bankMovement.movimiento ?? "—"}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!isReconciled(detail.status) && detail.status !== "ignored" && (
                      <Button
                        size="sm"
                        onClick={() => { setRecBmId(null); setRecNotes(""); setRecOpen(true); }}
                        className=" text-xs h-7"
                      >
                        <Link2 className="w-3 h-3 mr-1" />
                        Conciliar
                      </Button>
                    )}
                    {detail.status === "difference" && (
                      <Button
                        size="sm"
                        onClick={() => { setJustifyText(""); setJustifyOpen(true); }}
                        className=" text-xs h-7"
                      >
                        <FileCheck className="w-3 h-3 mr-1" />
                        Justificar diferencia
                      </Button>
                    )}
                    {isReconciled(detail.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => unreconcileMut.mutate({ batchId: selectedId })}
                        disabled={unreconcileMut.isPending}
                        className="border-border text-foreground hover:text-foreground text-xs h-7"
                      >
                        <Unlink className="w-3 h-3 mr-1" />
                        Desconciliar
                      </Button>
                    )}
                    {detail.status === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setIgnNotes(""); setIgnOpen(true); }}
                        className="border-border text-foreground hover:text-foreground text-xs h-7"
                      >
                        <Ban className="w-3 h-3 mr-1" />
                        Ignorar
                      </Button>
                    )}
                    {!isReconciled(detail.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if ((await confirmAction({ description: "¿Eliminar esta remesa? Las operaciones volverán a estado Pendiente.", destructive: true }))) {
                            deleteMut.mutate({ batchId: selectedId });
                          }
                        }}
                        disabled={deleteMut.isPending}
                        className="border-danger/50 text-danger hover:text-danger text-xs h-7"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Operations */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Operaciones ({detail.operations?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800">
                    {(detail.operations ?? []).map(op => (
                      <div key={op.batchOpId} className="px-3 py-2 flex items-center gap-2">
                        {op.batchOpType === "VENTA" ? (
                          <ArrowUpRight className="w-3 h-3 text-success shrink-0" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3 text-danger shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-foreground overflow-hidden text-ellipsis whitespace-nowrap">Op. {op.operationNumber}</div>
                          <div className="text-xs text-muted-foreground">
                            {op.card ? `****${op.card.slice(-4)}` : "—"} ·{" "}
                            {op.operationDatetime
                              ? new Date(op.operationDatetime).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                              : "—"}
                          </div>
                        </div>
                        <div className={`text-xs font-medium shrink-0 ${op.batchOpType === "VENTA" ? "text-success" : "text-danger"}`}>
                          {fmt(op.amount)}
                        </div>
                        {op.linkedEntityId && (
                          <StatusBadge tone="info">
                            {op.linkedEntityType}
                          </StatusBadge>
                        )}
                        <button
                          onClick={() => { setDelOpTarget({ batchOpId: op.batchOpId, operationNumber: op.operationNumber ?? null, amount: String(op.amount) }); setDelOpOpen(true); }}
                          className="shrink-0 p-1 rounded hover:bg-danger/10 text-muted-foreground hover:text-danger transition-colors"
                          title="Eliminar operación de la remesa"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Bank movement suggestions (manual search) */}
              {!isReconciled(detail.status) && detail.status !== "ignored" && (
                <Card className="bg-card border-border">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Movimientos bancarios sugeridos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {suggestQ.isLoading ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground">Buscando...</div>
                    ) : suggestions.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground">
                        No se encontraron movimientos bancarios compatibles en ±4 días
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-800 max-h-56 overflow-y-auto">
                        {suggestions.map(bm => {
                          const score = bm.confidenceScore;
                          const scoreColor = score >= 70 ? "text-success" : score >= 40 ? "text-warning" : "text-muted-foreground";
                          const isSelected = recBmId === bm.id;
                          return (
                            <button
                              key={bm.id}
                              onClick={() => setRecBmId(isSelected ? null : bm.id)}
                              className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors ${isSelected ? "bg-muted/70 ring-1 ring-success/40 ring-inset" : ""}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-foreground">{bm.fecha}</span>
                                  <span className="text-xs font-semibold text-foreground">{fmt(bm.importe)}</span>
                                </div>
                                <div className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{bm.movimiento ?? "—"}</div>
                              </div>
                              <div className={`text-xs font-bold shrink-0 ${scoreColor}`}>{score}%</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {recBmId && (
                      <div className="px-4 pb-3 pt-2">
                        <Button
                          size="sm"
                          onClick={() => { setRecNotes(""); setRecOpen(true); }}
                          className="w-full text-xs h-7"
                        >
                          <Link2 className="w-3 h-3 mr-1" />
                          Conciliar con este movimiento
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Generar remesas TPV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Se agrupan todas las operaciones TPV del período seleccionado por fecha y terminal,
              creando una remesa diaria para cada grupo.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Desde</Label>
                <Input
                  type="date"
                  value={genFrom}
                  onChange={e => setGenFrom(e.target.value)}
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-muted-foreground">Hasta</Label>
                <Input
                  type="date"
                  value={genTo}
                  onChange={e => setGenTo(e.target.value)}
                  className="bg-muted border-border text-foreground"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} className="border-border text-foreground">
              Cancelar
            </Button>
            <Button
              onClick={() => generateMut.mutate({ fromDate: genFrom, toDate: genTo })}
              disabled={generateMut.isPending || !genFrom || !genTo}
             
            >
              {generateMut.isPending ? "Generando..." : "Generar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation dialog */}
      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Conciliar remesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {recBmId == null && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">ID movimiento bancario</Label>
                <Input
                  type="number"
                  placeholder="ID del movimiento"
                  onChange={e => setRecBmId(parseInt(e.target.value) || null)}
                  className="bg-muted border-border text-foreground"
                />
              </div>
            )}
            {recBmId && detail && (
              <div className="bg-muted/60 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Remesa neto:</span>
                  <span className="text-foreground font-medium">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mov. banco ID:</span>
                  <span className="text-foreground">{recBmId}</span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Notas (opcional)</Label>
              <Textarea
                value={recNotes}
                onChange={e => setRecNotes(e.target.value)}
                placeholder="Observaciones sobre la conciliación..."
                className="bg-muted border-border text-foreground text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecOpen(false)} className="border-border text-foreground">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || !recBmId) return;
                reconcileMut.mutate({ batchId: selectedId, bankMovementId: recBmId, notes: recNotes || undefined });
              }}
              disabled={reconcileMut.isPending || !recBmId}
             
            >
              {reconcileMut.isPending ? "Conciliando..." : "Confirmar conciliación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={ignOpen} onOpenChange={setIgnOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Ignorar remesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Esta remesa quedará marcada como ignorada y no aparecerá en las conciliaciones pendientes.
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Motivo (opcional)</Label>
              <Textarea
                value={ignNotes}
                onChange={e => setIgnNotes(e.target.value)}
                placeholder="Motivo por el que se ignora esta remesa..."
                className="bg-muted border-border text-foreground text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnOpen(false)} className="border-border text-foreground">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId) return;
                ignoreMut.mutate({ batchId: selectedId, notes: ignNotes || undefined });
              }}
              disabled={ignoreMut.isPending}
              className="bg-muted hover:bg-muted text-foreground"
            >
              {ignoreMut.isPending ? "Guardando..." : "Ignorar remesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete operation dialog */}
      <Dialog open={delOpOpen} onOpenChange={(v) => { setDelOpOpen(v); if (!v) setDelOpTarget(null); }}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar operación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {delOpTarget && (
              <div className="bg-muted/60 rounded p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Operación:</span>
                  <span className="text-foreground">Op. {delOpTarget.operationNumber ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Importe:</span>
                  <span className="text-foreground font-medium">{fmt(delOpTarget.amount)}</span>
                </div>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              La operación se desvinculará de esta remesa y volverá a estado <span className="text-foreground">Pendiente</span>. Los totales de la remesa se recalcularán automáticamente.
            </p>
            {detail?.status === "reconciled" || detail?.status === "difference" ? (
              <div className="bg-warning/10 border border-warning/30 rounded p-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <span className="text-xs text-warning">
                  La remesa está conciliada. Al eliminar la operación se recalculará la diferencia con el banco.
                </span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDelOpOpen(false); setDelOpTarget(null); }} className="border-border text-foreground">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || !delOpTarget) return;
                removeOpMut.mutate({ batchId: selectedId, batchOpId: delOpTarget.batchOpId });
              }}
              disabled={removeOpMut.isPending}
              className="bg-danger hover:bg-danger/90 text-primary-foreground"
            >
              {removeOpMut.isPending ? "Eliminando..." : "Eliminar operación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Justify difference dialog */}
      <Dialog open={justifyOpen} onOpenChange={setJustifyOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-warning" />
              Justificar diferencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {detail?.differenceAmount && (
              <div className="bg-warning/10 border border-warning/30 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Neto remesa:</span>
                  <span className="text-foreground font-medium">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Importe banco:</span>
                  <span className="text-foreground">{fmt(detail.bankMovement?.importe)}</span>
                </div>
                <div className="flex justify-between border-t border-warning/20 pt-1">
                  <span className="text-warning">Diferencia:</span>
                  <span className="text-warning font-semibold">{fmt(detail.differenceAmount)}</span>
                </div>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Explica el motivo de la diferencia. La remesa pasará a estado <span className="text-success">Conciliada</span> y dejará de aparecer en las alertas del dashboard.
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Justificación <span className="text-danger">*</span></Label>
              <Textarea
                value={justifyText}
                onChange={e => setJustifyText(e.target.value)}
                placeholder="Ej: Comisión bancaria de 35,30 € descontada por el banco en la liquidación del terminal..."
                className="bg-muted border-border text-foreground text-sm resize-none"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">Mínimo 5 caracteres</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJustifyOpen(false)} className="border-border text-foreground">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || justifyText.trim().length < 5) return;
                justifyMut.mutate({ batchId: selectedId, justification: justifyText.trim() });
              }}
              disabled={justifyMut.isPending || justifyText.trim().length < 5}
             
            >
              {justifyMut.isPending ? "Guardando..." : "Confirmar justificación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
