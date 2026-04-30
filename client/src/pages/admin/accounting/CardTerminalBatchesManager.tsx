import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
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

const STATUS_COLORS: Record<BatchStatus, string> = {
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  suggested: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  auto_ready: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  reconciled: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  difference: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  ignored: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  review_required: "bg-red-500/15 text-red-400 border-red-500/30",
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Remesas TPV</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Agrupa operaciones TPV diarias y concília con movimientos bancarios
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => runMatchingMut.mutate()}
              disabled={runMatchingMut.isPending}
              className="border-zinc-700 text-zinc-300 hover:text-white text-sm"
            >
              <Play className="w-4 h-4 mr-2" />
              {runMatchingMut.isPending ? "Ejecutando..." : "Ejecutar matching"}
            </Button>
            <Button onClick={() => setGenOpen(true)} className="bg-orange-600 hover:bg-orange-500 text-white">
              <Package className="w-4 h-4 mr-2" />
              Generar remesas
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total", value: stats.total, icon: Package, color: "text-zinc-300" },
            { label: "Pendientes", value: stats.pending, icon: Clock, color: "text-yellow-400" },
            { label: "Acción requerida", value: stats.needsAction, icon: Zap, color: "text-blue-400" },
            { label: "Conciliadas", value: stats.reconciled, icon: CheckCircle2, color: "text-emerald-400" },
          ].map(s => (
            <Card key={s.label} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 flex items-center gap-3">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div>
                  <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-zinc-500">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-zinc-400">Desde</Label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={e => setFromDate(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-zinc-400">Hasta</Label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={e => setToDate(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white w-40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-zinc-400">Estado</Label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as BatchStatus | "")}
                  className="bg-zinc-800 border border-zinc-700 text-white text-sm rounded-md px-3 py-2 h-10"
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
                className="border-zinc-700 text-zinc-300 hover:text-white"
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
            <Card className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-zinc-300">
                  {batches.length} remesa(s)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {listQ.isLoading ? (
                  <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">Cargando...</div>
                ) : batches.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-500">
                    <Package className="w-8 h-8" />
                    <span className="text-sm">No hay remesas en este período</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGenOpen(true)}
                      className="mt-2 border-zinc-700 text-zinc-300"
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
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-zinc-800/50 transition-colors ${
                          selectedId === batch.id ? "bg-zinc-800/70" : ""
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">{fmtDate(batch.batchDate)}</span>
                            <Badge className={`text-xs border px-1.5 py-0 ${STATUS_COLORS[batch.status as BatchStatus] ?? ""}`}>
                              {STATUS_LABELS[batch.status as BatchStatus] ?? batch.status}
                            </Badge>
                            {batch.suggestedScore != null && (
                              <span className="text-xs text-zinc-400">
                                {scoreIcon(batch.suggestedScore)} {batch.suggestedScore}%
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-400">
                            <span>Terminal: {batch.terminalCode ?? "—"}</span>
                            <span>{batch.operationCount} ops</span>
                            {batch.differenceAmount && (
                              <span className="text-orange-400">Δ {fmt(batch.differenceAmount)}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-emerald-400">{fmt(batch.totalNet)}</div>
                          <div className="text-xs text-zinc-500">neto</div>
                        </div>
                        <ChevronRight className={`w-4 h-4 text-zinc-500 transition-transform ${selectedId === batch.id ? "rotate-90" : ""}`} />
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
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base text-white">
                        Remesa {fmtDate(detail.batchDate)}
                      </CardTitle>
                      <div className="text-xs text-zinc-400 mt-0.5">
                        Terminal {detail.terminalCode ?? "—"} · Comercio {detail.commerceCode ?? "—"}
                      </div>
                    </div>
                    <Badge className={`text-xs border px-1.5 py-0.5 ${STATUS_COLORS[detail.status as BatchStatus] ?? ""}`}>
                      {STATUS_LABELS[detail.status as BatchStatus] ?? detail.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-zinc-800/60 rounded p-2">
                      <div className="text-emerald-400 font-semibold text-sm">{fmt(detail.totalSales)}</div>
                      <div className="text-xs text-zinc-500">Ventas</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2">
                      <div className="text-red-400 font-semibold text-sm">{fmt(detail.totalRefunds)}</div>
                      <div className="text-xs text-zinc-500">Devol.</div>
                    </div>
                    <div className="bg-zinc-800/60 rounded p-2">
                      <div className="text-white font-bold text-sm">{fmt(detail.totalNet)}</div>
                      <div className="text-xs text-zinc-500">Neto</div>
                    </div>
                  </div>

                  {detail.differenceAmount && (
                    <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
                        <span className="text-xs text-orange-300">
                          Diferencia con banco: {fmt(detail.differenceAmount)}
                        </span>
                      </div>
                      {detail.notes && (
                        <div className="text-xs text-zinc-400 italic border-t border-orange-500/20 pt-2">
                          Justificación: {detail.notes}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Suggested bank movement (auto-matching) */}
                  {isSuggested(detail.status) && detail.suggestedBankMovementId && (
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-blue-300 font-medium">
                          {scoreIcon(detail.suggestedScore)} Match automático · Score {detail.suggestedScore}%
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400">
                        Mov. bancario ID: <span className="text-zinc-200">{detail.suggestedBankMovementId}</span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => acceptMut.mutate({ batchId: selectedId })}
                          disabled={acceptMut.isPending}
                          className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white text-xs h-7"
                        >
                          <ThumbsUp className="w-3 h-3 mr-1" />
                          Aceptar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => rejectMut.mutate({ batchId: selectedId })}
                          disabled={rejectMut.isPending}
                          className="flex-1 border-red-900/50 text-red-400 hover:text-red-300 text-xs h-7"
                        >
                          <ThumbsDown className="w-3 h-3 mr-1" />
                          Rechazar
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Review required alert */}
                  {detail.status === "review_required" && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded p-2 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <span className="text-xs text-red-300">
                        Sin movimiento bancario coincidente. Concilia manualmente.
                      </span>
                    </div>
                  )}

                  {/* Bank movement linked */}
                  {detail.bankMovement && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-2">
                      <div className="text-xs text-emerald-300 font-medium mb-1">Movimiento bancario vinculado</div>
                      <div className="text-xs text-zinc-300">
                        {detail.bankMovement.fecha} · {fmt(detail.bankMovement.importe)}
                      </div>
                      <div className="text-xs text-zinc-500 truncate">
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
                        className="bg-emerald-700 hover:bg-emerald-600 text-white text-xs h-7"
                      >
                        <Link2 className="w-3 h-3 mr-1" />
                        Conciliar
                      </Button>
                    )}
                    {detail.status === "difference" && (
                      <Button
                        size="sm"
                        onClick={() => { setJustifyText(""); setJustifyOpen(true); }}
                        className="bg-amber-700 hover:bg-amber-600 text-white text-xs h-7"
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
                        className="border-zinc-600 text-zinc-300 hover:text-white text-xs h-7"
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
                        className="border-zinc-600 text-zinc-300 hover:text-white text-xs h-7"
                      >
                        <Ban className="w-3 h-3 mr-1" />
                        Ignorar
                      </Button>
                    )}
                    {!isReconciled(detail.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("¿Eliminar esta remesa? Las operaciones volverán a estado Pendiente.")) {
                            deleteMut.mutate({ batchId: selectedId });
                          }
                        }}
                        disabled={deleteMut.isPending}
                        className="border-red-900/50 text-red-400 hover:text-red-300 text-xs h-7"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Eliminar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Operations */}
              <Card className="bg-zinc-900 border-zinc-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                    Operaciones ({detail.operations?.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-48 overflow-y-auto divide-y divide-zinc-800">
                    {(detail.operations ?? []).map(op => (
                      <div key={op.batchOpId} className="px-3 py-2 flex items-center gap-2">
                        {op.batchOpType === "VENTA" ? (
                          <ArrowUpRight className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : (
                          <ArrowDownLeft className="w-3 h-3 text-red-400 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-zinc-300 truncate">Op. {op.operationNumber}</div>
                          <div className="text-xs text-zinc-500">
                            {op.card ? `****${op.card.slice(-4)}` : "—"} ·{" "}
                            {op.operationDatetime
                              ? new Date(op.operationDatetime).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
                              : "—"}
                          </div>
                        </div>
                        <div className={`text-xs font-medium shrink-0 ${op.batchOpType === "VENTA" ? "text-emerald-400" : "text-red-400"}`}>
                          {fmt(op.amount)}
                        </div>
                        {op.linkedEntityId && (
                          <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs px-1 py-0">
                            {op.linkedEntityType}
                          </Badge>
                        )}
                        <button
                          onClick={() => { setDelOpTarget({ batchOpId: op.batchOpId, operationNumber: op.operationNumber ?? null, amount: String(op.amount) }); setDelOpOpen(true); }}
                          className="shrink-0 p-1 rounded hover:bg-red-500/10 text-zinc-600 hover:text-red-400 transition-colors"
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
                <Card className="bg-zinc-900 border-zinc-800">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                      Movimientos bancarios sugeridos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {suggestQ.isLoading ? (
                      <div className="px-4 py-3 text-xs text-zinc-500">Buscando...</div>
                    ) : suggestions.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-zinc-500">
                        No se encontraron movimientos bancarios compatibles en ±4 días
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-800 max-h-56 overflow-y-auto">
                        {suggestions.map(bm => {
                          const score = bm.confidenceScore;
                          const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-yellow-400" : "text-zinc-400";
                          const isSelected = recBmId === bm.id;
                          return (
                            <button
                              key={bm.id}
                              onClick={() => setRecBmId(isSelected ? null : bm.id)}
                              className={`w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-zinc-800/50 transition-colors ${isSelected ? "bg-zinc-800/70 ring-1 ring-emerald-500/40 ring-inset" : ""}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-zinc-300">{bm.fecha}</span>
                                  <span className="text-xs font-semibold text-white">{fmt(bm.importe)}</span>
                                </div>
                                <div className="text-xs text-zinc-500 truncate">{bm.movimiento ?? "—"}</div>
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
                          className="w-full bg-emerald-700 hover:bg-emerald-600 text-white text-xs h-7"
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
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Generar remesas TPV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-zinc-400">
              Se agrupan todas las operaciones TPV del período seleccionado por fecha y terminal,
              creando una remesa diaria para cada grupo.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-zinc-400">Desde</Label>
                <Input
                  type="date"
                  value={genFrom}
                  onChange={e => setGenFrom(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-xs text-zinc-400">Hasta</Label>
                <Input
                  type="date"
                  value={genTo}
                  onChange={e => setGenTo(e.target.value)}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} className="border-zinc-700 text-zinc-300">
              Cancelar
            </Button>
            <Button
              onClick={() => generateMut.mutate({ fromDate: genFrom, toDate: genTo })}
              disabled={generateMut.isPending || !genFrom || !genTo}
              className="bg-orange-600 hover:bg-orange-500 text-white"
            >
              {generateMut.isPending ? "Generando..." : "Generar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation dialog */}
      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Conciliar remesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {recBmId == null && (
              <div className="space-y-2">
                <Label className="text-xs text-zinc-400">ID movimiento bancario</Label>
                <Input
                  type="number"
                  placeholder="ID del movimiento"
                  onChange={e => setRecBmId(parseInt(e.target.value) || null)}
                  className="bg-zinc-800 border-zinc-700 text-white"
                />
              </div>
            )}
            {recBmId && detail && (
              <div className="bg-zinc-800/60 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Remesa neto:</span>
                  <span className="text-white font-medium">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Mov. banco ID:</span>
                  <span className="text-white">{recBmId}</span>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs text-zinc-400">Notas (opcional)</Label>
              <Textarea
                value={recNotes}
                onChange={e => setRecNotes(e.target.value)}
                placeholder="Observaciones sobre la conciliación..."
                className="bg-zinc-800 border-zinc-700 text-white text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecOpen(false)} className="border-zinc-700 text-zinc-300">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || !recBmId) return;
                reconcileMut.mutate({ batchId: selectedId, bankMovementId: recBmId, notes: recNotes || undefined });
              }}
              disabled={reconcileMut.isPending || !recBmId}
              className="bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              {reconcileMut.isPending ? "Conciliando..." : "Confirmar conciliación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={ignOpen} onOpenChange={setIgnOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Ignorar remesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-400">
              Esta remesa quedará marcada como ignorada y no aparecerá en las conciliaciones pendientes.
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-400">Motivo (opcional)</Label>
              <Textarea
                value={ignNotes}
                onChange={e => setIgnNotes(e.target.value)}
                placeholder="Motivo por el que se ignora esta remesa..."
                className="bg-zinc-800 border-zinc-700 text-white text-sm resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnOpen(false)} className="border-zinc-700 text-zinc-300">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId) return;
                ignoreMut.mutate({ batchId: selectedId, notes: ignNotes || undefined });
              }}
              disabled={ignoreMut.isPending}
              className="bg-zinc-700 hover:bg-zinc-600 text-white"
            >
              {ignoreMut.isPending ? "Guardando..." : "Ignorar remesa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete operation dialog */}
      <Dialog open={delOpOpen} onOpenChange={(v) => { setDelOpOpen(v); if (!v) setDelOpTarget(null); }}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar operación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {delOpTarget && (
              <div className="bg-zinc-800/60 rounded p-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Operación:</span>
                  <span className="text-white">Op. {delOpTarget.operationNumber ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Importe:</span>
                  <span className="text-white font-medium">{fmt(delOpTarget.amount)}</span>
                </div>
              </div>
            )}
            <p className="text-sm text-zinc-400">
              La operación se desvinculará de esta remesa y volverá a estado <span className="text-white">Pendiente</span>. Los totales de la remesa se recalcularán automáticamente.
            </p>
            {detail?.status === "reconciled" || detail?.status === "difference" ? (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="text-xs text-amber-300">
                  La remesa está conciliada. Al eliminar la operación se recalculará la diferencia con el banco.
                </span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDelOpOpen(false); setDelOpTarget(null); }} className="border-zinc-700 text-zinc-300">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || !delOpTarget) return;
                removeOpMut.mutate({ batchId: selectedId, batchOpId: delOpTarget.batchOpId });
              }}
              disabled={removeOpMut.isPending}
              className="bg-red-700 hover:bg-red-600 text-white"
            >
              {removeOpMut.isPending ? "Eliminando..." : "Eliminar operación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Justify difference dialog */}
      <Dialog open={justifyOpen} onOpenChange={setJustifyOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-amber-400" />
              Justificar diferencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {detail?.differenceAmount && (
              <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Neto remesa:</span>
                  <span className="text-white font-medium">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Importe banco:</span>
                  <span className="text-white">{fmt(detail.bankMovement?.importe)}</span>
                </div>
                <div className="flex justify-between border-t border-orange-500/20 pt-1">
                  <span className="text-orange-300">Diferencia:</span>
                  <span className="text-orange-300 font-semibold">{fmt(detail.differenceAmount)}</span>
                </div>
              </div>
            )}
            <p className="text-sm text-zinc-400">
              Explica el motivo de la diferencia. La remesa pasará a estado <span className="text-emerald-400">Conciliada</span> y dejará de aparecer en las alertas del dashboard.
            </p>
            <div className="space-y-1">
              <Label className="text-xs text-zinc-400">Justificación <span className="text-red-400">*</span></Label>
              <Textarea
                value={justifyText}
                onChange={e => setJustifyText(e.target.value)}
                placeholder="Ej: Comisión bancaria de 35,30 € descontada por el banco en la liquidación del terminal..."
                className="bg-zinc-800 border-zinc-700 text-white text-sm resize-none"
                rows={3}
              />
              <p className="text-xs text-zinc-500">Mínimo 5 caracteres</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJustifyOpen(false)} className="border-zinc-700 text-zinc-300">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!selectedId || justifyText.trim().length < 5) return;
                justifyMut.mutate({ batchId: selectedId, justification: justifyText.trim() });
              }}
              disabled={justifyMut.isPending || justifyText.trim().length < 5}
              className="bg-amber-700 hover:bg-amber-600 text-white"
            >
              {justifyMut.isPending ? "Guardando..." : "Confirmar justificación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
