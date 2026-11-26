import { useState } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { SummaryStrip, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/errorMessage";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EconomyFilterBar, EconomyTable, FilterField, FormField, FormFooter, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { EconomyPager } from "./shared/EconomyParts";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Package,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Link2,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Play,
  ThumbsUp,
  ThumbsDown,
  Zap,
  Unlink,
  Ban,
  Trash2,
  X,
  FileCheck,
  MoreHorizontal,
} from "lucide-react";

type BatchStatus = "pending" | "suggested" | "auto_ready" | "reconciled" | "difference" | "ignored" | "review_required";
const STATUS_KEYS: readonly BatchStatus[] = ["pending", "suggested", "auto_ready", "reconciled", "difference", "ignored", "review_required"];

const STATUS_TONES: Record<BatchStatus, Tone> = {
  pending: "warning",
  suggested: "info",
  auto_ready: "success",
  reconciled: "success",
  difference: "warning",
  ignored: "neutral",
  review_required: "danger",
};

const matchTone = (score: number): Tone => (score >= 80 ? "success" : score >= 50 ? "warning" : "danger");
const isSuggested = (s: string) => s === "suggested" || s === "auto_ready";
const isReconciled = (s: string) => s === "reconciled" || s === "difference";
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthStart = () => { const d = new Date(); d.setDate(1); return iso(d); };
const today = () => iso(new Date());

export default function CardTerminalBatchesManager() {
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<BatchStatus | "">("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genFrom, setGenFrom] = useState(monthStart);
  const [genTo, setGenTo] = useState(today);

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

  // El listado y el estado de la conciliación comparten el periodo; el listado, además, el estado elegido
  const period = { fromDate: fromDate || undefined, toDate: toDate || undefined };
  const listQ = trpc.cardTerminalBatches.listPage.useQuery({ ...period, status: statusFilter || undefined, page: page + 1, pageSize });
  const summaryQ = trpc.cardTerminalBatches.summary.useQuery({ ...period, status: statusFilter || undefined });

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
    utils.cardTerminalBatches.listPage.invalidate();
    utils.cardTerminalBatches.summary.invalidate();
    if (selectedId) utils.cardTerminalBatches.getById.invalidate({ id: selectedId });
  }

  const generateMut = trpc.cardTerminalBatches.generate.useMutation({
    onSuccess: (res) => {
      toast.success(t("economyBatches.toast.generated", { batches: res.batchesCreated, ops: res.operationsIncluded }));
      setGenOpen(false);
      utils.cardTerminalBatches.listPage.invalidate();
      utils.cardTerminalBatches.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const runMatchingMut = trpc.cardTerminalBatches.runMatching.useMutation({
    onSuccess: (res) => {
      toast.success(t("economyBatches.toast.matching", { processed: res.processed, suggested: res.suggested, ready: res.autoReady, auto: res.autoReconciled }));
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const acceptMut = trpc.cardTerminalBatches.acceptSuggestion.useMutation({
    onSuccess: (res) => {
      if (res.hasDifference) {
        toast.warning(t("economyBatches.toast.reconciledDiff", { amount: money.eur(res.differenceAmount) }));
      } else {
        toast.success(t("economyBatches.toast.accepted"));
      }
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const rejectMut = trpc.cardTerminalBatches.rejectSuggestion.useMutation({
    onSuccess: () => {
      toast.success(t("economyBatches.toast.rejected"));
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const reconcileMut = trpc.cardTerminalBatches.reconcile.useMutation({
    onSuccess: (res) => {
      if (res.hasDifference) {
        toast.warning(t("economyBatches.toast.reconciledDiff", { amount: money.eur(res.differenceAmount) }));
      } else {
        toast.success(t("economyBatches.toast.reconciled"));
      }
      setRecOpen(false);
      setRecBmId(null);
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const unreconcileMut = trpc.cardTerminalBatches.unreconcile.useMutation({
    onSuccess: () => {
      toast.success(t("economyBatches.toast.unreconciled"));
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const ignoreMut = trpc.cardTerminalBatches.markIgnored.useMutation({
    onSuccess: () => {
      toast.success(t("economyBatches.toast.ignored"));
      setIgnOpen(false);
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const deleteMut = trpc.cardTerminalBatches.deleteBatch.useMutation({
    onSuccess: () => {
      toast.success(t("economyBatches.toast.deleted"));
      setSelectedId(null);
      utils.cardTerminalBatches.listPage.invalidate();
      utils.cardTerminalBatches.summary.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const removeOpMut = trpc.cardTerminalBatches.removeOperation.useMutation({
    onSuccess: (res) => {
      toast.success(t("economyBatches.toast.opRemoved", { net: money.eur(res.newTotalNet), remaining: res.remainingOps }));
      setDelOpOpen(false);
      setDelOpTarget(null);
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const justifyMut = trpc.cardTerminalBatches.justifyDifference.useMutation({
    onSuccess: () => {
      toast.success(t("economyBatches.toast.justified"));
      setJustifyOpen(false);
      setJustifyText("");
      invalidateAll();
    },
    onError: (e) => toastError(e),
  });

  const batches = listQ.data?.data ?? [];
  const total = listQ.data?.total ?? 0;
  const detail = detailQ.data ?? null;
  const suggestions = suggestQ.data ?? [];
  const conc = summaryQ.data?.conciliation;

  type Batch = (typeof batches)[number];
  const statusLabel = (s: string) => ((STATUS_KEYS as readonly string[]).includes(s) ? t(`economyBatches.status.${s}`) : s);
  const statusBadge = (s: string) => <StatusBadge tone={STATUS_TONES[s as BatchStatus] ?? "neutral"}>{statusLabel(s)}</StatusBadge>;
  const fmtDate = (s: string | null | undefined) => (s ? f.date(new Date(`${s.slice(0, 10)}T00:00:00`)) : "—");
  const fmt = (v: string | number | null | undefined) => money.eur(v, { nullAs: "—" });
  const matchBadge = (score: number) => <StatusBadge tone={matchTone(score)}>{t("economyBatches.match", { score })}</StatusBadge>;

  const defaultFrom = monthStart();
  const defaultTo = today();
  const clearFilters = () => { setFromDate(defaultFrom); setToDate(defaultTo); setStatusFilter(""); setPage(0); };
  const chips: FilterChip[] = [
    ...(statusFilter ? [{ id: "status", label: t("economyBatches.chip.status", { value: statusLabel(statusFilter) }), onRemove: () => { setStatusFilter(""); setPage(0); } }] : []),
    ...(fromDate !== defaultFrom ? [{ id: "from", label: fromDate ? t("economyBatches.chip.from", { value: fmtDate(fromDate) }) : t("economyBatches.chip.noFrom"), onRemove: () => { setFromDate(defaultFrom); setPage(0); } }] : []),
    ...(toDate !== defaultTo ? [{ id: "to", label: toDate ? t("economyBatches.chip.to", { value: fmtDate(toDate) }) : t("economyBatches.chip.noTo"), onRemove: () => { setToDate(defaultTo); setPage(0); } }] : []),
  ];

  const periodLabel = fromDate && toDate
    ? t("economyBatches.conc.period", { from: fmtDate(fromDate), to: fmtDate(toDate) })
    : fromDate
      ? t("economyBatches.conc.periodFrom", { from: fmtDate(fromDate) })
      : toDate
        ? t("economyBatches.conc.periodTo", { to: fmtDate(toDate) })
        : t("economyBatches.conc.periodAll");

  const toggleStatus = (s: BatchStatus) => { setStatusFilter((cur) => (cur === s ? "" : s)); setPage(0); };
  const dash = "—";
  const stripItems: SummaryStripItem[] = [
    {
      key: "pct",
      label: t("economyBatches.conc.pct"),
      value: conc ? `${conc.pctReconciled}%` : dash,
      detail: conc ? t("economyBatches.conc.pctDetail", { done: conc.reconciled.count, total: conc.total.count }) : undefined,
      primary: true,
      tone: !conc ? undefined : conc.pctReconciled >= 80 ? "success" : conc.pctReconciled >= 50 ? "warning" : "danger",
    },
    {
      key: "reconciled",
      label: t("economyBatches.conc.reconciledAmount"),
      value: conc ? money.eur(conc.reconciled.amount) : dash,
      tone: "success",
    },
    {
      key: "pending",
      label: conc ? t("economyBatches.conc.pendingLabel", { count: conc.pending.count }) : t("economyBatches.conc.pendingAmount"),
      value: conc ? money.eur(conc.pending.amount) : dash,
      tone: conc && conc.pending.count > 0 ? "warning" : "success",
    },
    {
      key: "differences",
      label: conc ? t("economyBatches.conc.differencesLabel", { count: conc.difference.count }) : t("economyBatches.conc.differences"),
      value: conc ? money.eur(conc.difference.amount) : dash,
      tone: conc && conc.difference.count > 0 ? "warning" : "success",
      onClick: () => toggleStatus("difference"),
      active: statusFilter === "difference",
    },
  ];

  const attention: Array<{ status: BatchStatus; icon: typeof Zap; tone: string; text: string; amount: string; count: number }> = conc
    ? [
        { status: "auto_ready" as const, icon: Zap, tone: "border-success/30 bg-success/10 text-success", text: t("economyBatches.conc.autoReady", { count: conc.attention.autoReady.count }), amount: conc.attention.autoReady.amount, count: conc.attention.autoReady.count },
        { status: "suggested" as const, icon: CheckCircle2, tone: "border-info/30 bg-info/10 text-info", text: t("economyBatches.conc.suggested", { count: conc.attention.suggested.count }), amount: conc.attention.suggested.amount, count: conc.attention.suggested.count },
        { status: "review_required" as const, icon: AlertTriangle, tone: "border-danger/30 bg-danger/10 text-danger", text: t("economyBatches.conc.reviewRequired", { count: conc.attention.reviewRequired.count }), amount: conc.attention.reviewRequired.amount, count: conc.attention.reviewRequired.count },
      ].filter((l) => l.count > 0)
    : [];

  const columns: EconomyColumn<Batch>[] = [
    {
      key: "fecha",
      header: t("economyBatches.col.date"),
      mobile: "title",
      cell: (b) => <span className="whitespace-nowrap">{fmtDate(b.batchDate)}</span>,
    },
    { key: "estado", header: t("economyBatches.col.state"), cell: (b) => statusBadge(b.status) },
    { key: "match", header: t("economyBatches.col.match"), priority: "md", cell: (b) => (b.suggestedScore != null ? matchBadge(b.suggestedScore) : <span className="text-muted-foreground">—</span>) },
    { key: "terminal", header: t("economyBatches.col.terminal"), priority: "md", cell: (b) => <span className="text-xs text-muted-foreground">{b.terminalCode ?? "—"}</span> },
    { key: "ops", header: t("economyBatches.col.ops"), align: "right", num: true, priority: "md", cell: (b) => b.operationCount },
    {
      key: "dif",
      header: t("economyBatches.col.diff"),
      align: "right",
      num: true,
      priority: "lg",
      cell: (b) => (b.differenceAmount ? <span className="text-warning">Δ {fmt(b.differenceAmount)}</span> : <span className="text-muted-foreground">—</span>),
    },
    { key: "neto", header: t("economyBatches.col.net"), align: "right", num: true, mobile: "amount", cell: (b) => <span className="font-semibold text-success">{fmt(b.totalNet)}</span> },
  ];

  const open = (id: number) => setSelectedId(id);
  const hasSuggestion = !!detail && isSuggested(detail.status) && !!detail.suggestedBankMovementId;
  const suggestedMovement = detail?.suggestedBankMovementId ? suggestions.find((s) => s.id === detail.suggestedBankMovementId) : undefined;
  const chosenMovement = recBmId ? suggestions.find((s) => s.id === recBmId) : undefined;
  const canReconcile = !!detail && !isReconciled(detail.status) && detail.status !== "ignored";
  const menuItems = detail
    ? [
        ...(hasSuggestion ? [{ key: "reject", label: t("economyBatches.action.reject"), icon: ThumbsDown, danger: true, onSelect: () => rejectMut.mutate({ batchId: selectedId! }) }] : []),
        ...(isReconciled(detail.status) ? [{ key: "unreconcile", label: t("economyBatches.action.unreconcile"), icon: Unlink, danger: false, onSelect: () => unreconcileMut.mutate({ batchId: selectedId! }) }] : []),
        ...(detail.status === "pending" ? [{ key: "ignore", label: t("economyBatches.action.ignore"), icon: Ban, danger: false, onSelect: () => { setIgnNotes(""); setIgnOpen(true); } }] : []),
        ...(!isReconciled(detail.status)
          ? [{
              key: "delete",
              label: t("economyBatches.action.delete"),
              icon: Trash2,
              danger: true,
              onSelect: async () => {
                if ((await confirmAction({ description: t("economyBatches.deleteConfirm"), destructive: true }))) {
                  deleteMut.mutate({ batchId: selectedId! });
                }
              },
            }]
          : []),
      ]
    : [];

  return (
    <AdminLayout>
      <EconomyShell screen="batches"
        description={t("economyBatches.description")}
        action={
          <>
            <Button variant="outline" onClick={() => runMatchingMut.mutate()} disabled={runMatchingMut.isPending}>
              <Play className="w-4 h-4 mr-2" aria-hidden="true" />
              {runMatchingMut.isPending ? t("economyBatches.running") : t("economyBatches.runMatching")}
            </Button>
            <Button onClick={() => setGenOpen(true)}>
              <Package className="w-4 h-4 mr-2" aria-hidden="true" />
              {t("economyBatches.generate")}
            </Button>
          </>
        }>
      <div className="flex flex-col gap-4">

        {/* Estado de la conciliación del periodo (la antigua pantalla «Conciliación TPV», integrada) */}
        <section aria-label={t("economyBatches.conc.title")} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{t("economyBatches.conc.title")}</h2>
            <p className="text-xs text-muted-foreground">{periodLabel}</p>
          </div>
          <SummaryStrip items={stripItems} label={t("economyBatches.conc.summaryLabel")} />
          <p className="text-xs text-muted-foreground">{t("economyBatches.conc.pendingHelp")}</p>
          {conc && attention.length > 0 && (
            <div role="group" aria-label={t("economyBatches.conc.attentionLabel")} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {attention.map((l) => {
                const Icon = l.icon;
                const on = statusFilter === l.status;
                return (
                  <button
                    key={l.status}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleStatus(l.status)}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      l.tone,
                      on && "ring-2 ring-ring",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2"><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0">{l.text}</span></span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{money.eur(l.amount)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {conc && attention.length === 0 && conc.total.count > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span className="font-medium text-success">{t("economyBatches.conc.allClear")}</span>
              <span className="text-xs text-muted-foreground">{t("economyBatches.conc.allClearDetail")}</span>
            </div>
          )}
        </section>

        {/* Filtros */}
        <EconomyFilterBar
          primary={
            <>
              <FilterField label={t("economyBatches.filter.from")} className="w-[calc(50%-0.375rem)] sm:w-40">
                <Input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => { setFromDate(e.target.value); setPage(0); }} />
              </FilterField>
              <FilterField label={t("economyBatches.filter.to")} className="w-[calc(50%-0.375rem)] sm:w-40">
                <Input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => { setToDate(e.target.value); setPage(0); }} />
              </FilterField>
              <FilterField label={t("economyBatches.filter.status")} className="w-full sm:w-48">
                <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v === "all" ? "" : (v as BatchStatus)); setPage(0); }}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("economyBatches.filter.all")}</SelectItem>
                    {STATUS_KEYS.map((s) => (
                      <SelectItem key={s} value={s}>{t(`economyBatches.status.${s}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            </>
          }
          actions={
            <Button variant="outline" onClick={() => { utils.cardTerminalBatches.listPage.invalidate(); utils.cardTerminalBatches.summary.invalidate(); }} aria-label={t("economyBatches.refreshAria")} className="gap-2">
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> {t("economyBatches.refresh")}
            </Button>
          }
          chips={chips}
          onClear={clearFilters}
          summary={t("economyBatches.resultCount", { count: total })}
        />

        {/* Lista de remesas: el detalle se abre en un cajón lateral (pantalla completa en móvil) */}
        <EconomyTable
          rows={batches}
          columns={columns}
          rowKey={(b) => b.id}
          caption={t("economyBatches.caption")}
          loading={listQ.isLoading}
          error={listQ.error}
          errorTitle={t("economyBatches.loadError")}
          onRetry={() => void listQ.refetch()}
          emptyTitle={t("economyBatches.empty.title")}
          emptyDescription={t("economyBatches.empty.description")}
          emptyAction={<Button variant="outline" size="sm" className="max-sm:h-10" onClick={() => setGenOpen(true)}>{t("economyBatches.empty.generate")}</Button>}
          rowClassName={(b) => (selectedId === b.id ? "bg-muted/70" : undefined)}
          onRowClick={(b) => open(b.id)}
          actions={(b) => (
            <RowActions
              label={fmtDate(b.batchDate)}
              primary={{ label: t("economyBatches.review"), icon: <ChevronRight className="h-4 w-4" />, onSelect: () => open(b.id) }}
            />
          )}
          mobileCard={(b) => (
            <button type="button" onClick={() => open(b.id)} className="block w-full min-w-0 space-y-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-start justify-between gap-3">
                <span className="font-medium text-foreground">{fmtDate(b.batchDate)}</span>
                <span className="shrink-0 font-semibold tabular-nums text-success">{fmt(b.totalNet)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {statusBadge(b.status)}
                {b.suggestedScore != null && matchBadge(b.suggestedScore)}
              </span>
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{b.terminalCode ?? "—"} · {b.operationCount}</span>
                {b.differenceAmount ? <span className="tabular-nums text-warning">Δ {fmt(b.differenceAmount)}</span> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
              </span>
            </button>
          )}
          footer={<EconomyPager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0); }} />}
        />
      </div>

      {/* ── Detalle de la remesa: cajón lateral en escritorio, pantalla completa con pie fijo en móvil ── */}
      <Sheet open={selectedId != null} onOpenChange={(o) => { if (!o) setSelectedId(null); }}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="space-y-1.5 border-b border-border p-4 pr-12">
            <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
              {detail ? t("economyBatches.detail.title", { date: fmtDate(detail.batchDate) }) : t("economyBatches.detail.loading")}
              {detail && statusBadge(detail.status)}
            </SheetTitle>
            <SheetDescription className={detail ? undefined : "sr-only"}>
              {detail ? t("economyBatches.detail.terminalCommerce", { terminal: detail.terminalCode ?? "—", commerce: detail.commerceCode ?? "—" }) : t("economyBatches.detail.description")}
            </SheetDescription>
          </SheetHeader>

          {detail && (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-muted/60 p-2">
                    <div className="text-sm font-semibold tabular-nums text-success">{fmt(detail.totalSales)}</div>
                    <div className="text-xs text-muted-foreground">{t("economyBatches.detail.sales")}</div>
                  </div>
                  <div className="rounded bg-muted/60 p-2">
                    <div className="text-sm font-semibold tabular-nums text-danger">{fmt(detail.totalRefunds)}</div>
                    <div className="text-xs text-muted-foreground">{t("economyBatches.detail.refunds")}</div>
                  </div>
                  <div className="rounded bg-muted/60 p-2">
                    <div className="text-sm font-bold tabular-nums text-foreground">{fmt(detail.totalNet)}</div>
                    <div className="text-xs text-muted-foreground">{t("economyBatches.detail.net")}</div>
                  </div>
                </div>

                {detail.differenceAmount && (
                  <div className="space-y-2 rounded border border-warning/30 bg-warning/10 p-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                      <span className="text-sm text-warning">{t("economyBatches.detail.difference", { amount: fmt(detail.differenceAmount) })}</span>
                    </div>
                    {detail.notes && (
                      <div className="border-t border-warning/20 pt-2 text-xs italic text-muted-foreground">
                        {t("economyBatches.detail.justification", { text: detail.notes })}
                      </div>
                    )}
                  </div>
                )}

                {/* Movimiento sugerido por el matching: fecha, importe, concepto y coincidencia */}
                {hasSuggestion && (
                  <div className="space-y-2 rounded border border-info/30 bg-info/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-info">{t("economyBatches.detail.suggestionTitle")}</span>
                      {detail.suggestedScore != null && matchBadge(detail.suggestedScore)}
                    </div>
                    {suggestedMovement ? (
                      <div className="space-y-0.5 text-sm">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-foreground">{fmtDate(suggestedMovement.fecha)}</span>
                          <span className="font-semibold tabular-nums text-foreground">{fmt(suggestedMovement.importe)}</span>
                        </div>
                        <div className="break-words text-xs text-muted-foreground">{suggestedMovement.movimiento ?? "—"}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{suggestQ.isLoading ? t("economyBatches.detail.searching") : t("economyBatches.detail.suggestionUnknown", { id: String(detail.suggestedBankMovementId) })}</div>
                    )}
                  </div>
                )}

                {detail.status === "review_required" && (
                  <div className="flex items-center gap-2 rounded border border-danger/30 bg-danger/10 p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                    <span className="text-sm text-danger">{t("economyBatches.detail.reviewRequired")}</span>
                  </div>
                )}

                {detail.bankMovement && (
                  <div className="rounded border border-success/30 bg-success/10 p-3">
                    <div className="mb-1 text-sm font-medium text-success">{t("economyBatches.detail.linkedBank")}</div>
                    <div className="flex items-baseline justify-between gap-3 text-sm text-foreground">
                      <span>{fmtDate(detail.bankMovement.fecha)}</span>
                      <span className="font-semibold tabular-nums">{fmt(detail.bankMovement.importe)}</span>
                    </div>
                    <div className="break-words text-xs text-muted-foreground">{detail.bankMovement.movimiento ?? "—"}</div>
                  </div>
                )}

                {/* Operaciones de la remesa */}
                <section aria-label={t("economyBatches.detail.operationsTitle", { count: detail.operations?.length ?? 0 })}>
                  <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("economyBatches.detail.operationsTitle", { count: detail.operations?.length ?? 0 })}</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {(detail.operations ?? []).map((op) => (
                      <li key={op.batchOpId} className="flex items-center gap-2 px-3 py-2">
                        {op.batchOpType === "VENTA" ? (
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                        ) : (
                          <ArrowDownLeft className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="whitespace-nowrap text-sm text-foreground">{t("economyBatches.detail.operationNo", { number: op.operationNumber })}</div>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                            <span>{op.card ? `****${op.card.slice(-4)}` : "—"} · {op.operationDatetime ? f.time(new Date(op.operationDatetime), { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                            {op.linkedEntityId && (
                              <StatusBadge tone="info">
                                {(op.linkedEntityType === "reservation" || op.linkedEntityType === "quote") ? t(`economyBatches.detail.entity.${op.linkedEntityType}`) : op.linkedEntityType}
                              </StatusBadge>
                            )}
                          </div>
                        </div>
                        <div className={cn("shrink-0 text-sm font-medium tabular-nums", op.batchOpType === "VENTA" ? "text-success" : "text-danger")}>{fmt(op.amount)}</div>
                        <button
                          type="button"
                          onClick={() => { setDelOpTarget({ batchOpId: op.batchOpId, operationNumber: op.operationNumber ?? null, amount: String(op.amount) }); setDelOpOpen(true); }}
                          aria-label={t("economyBatches.detail.removeOp", { number: op.operationNumber ?? "" })}
                          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:w-8"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Otros movimientos bancarios compatibles (búsqueda manual) */}
                {canReconcile && (
                  <section aria-label={t("economyBatches.detail.suggestedTitle")}>
                    <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("economyBatches.detail.suggestedTitle")}</h3>
                    {suggestQ.isLoading ? (
                      <div className="text-sm text-muted-foreground">{t("economyBatches.detail.searching")}</div>
                    ) : suggestions.length === 0 ? (
                      <div className="text-sm text-muted-foreground">{t("economyBatches.detail.noneFound")}</div>
                    ) : (
                      <ul className="divide-y divide-border rounded-lg border border-border">
                        {suggestions.map((bm) => {
                          const isSelected = recBmId === bm.id;
                          return (
                            <li key={bm.id}>
                              <button
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={t("economyBatches.detail.selectMovement", { date: fmtDate(bm.fecha), amount: fmt(bm.importe) })}
                                onClick={() => setRecBmId(isSelected ? null : bm.id)}
                                className={cn("flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isSelected && "bg-muted/70 ring-1 ring-inset ring-success/40")}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-baseline justify-between gap-3 text-sm">
                                    <span className="text-foreground">{fmtDate(bm.fecha)}</span>
                                    <span className="font-semibold tabular-nums text-foreground">{fmt(bm.importe)}</span>
                                  </div>
                                  <div className="break-words text-xs text-muted-foreground">{bm.movimiento ?? "—"}</div>
                                </div>
                                <span className="shrink-0">{matchBadge(bm.confidenceScore)}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {recBmId && (
                      <Button className="mt-2 w-full max-sm:h-11" onClick={() => { setRecNotes(""); setRecOpen(true); }}>
                        <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t("economyBatches.detail.reconcileWith")}
                      </Button>
                    )}
                  </section>
                )}
              </div>

              {/* Pie fijo: acciones principales siempre visibles; las destructivas, en el menú «Más» */}
              <div className="flex flex-wrap items-center gap-2 border-t border-border bg-background p-3 pb-6 max-sm:[&>button]:min-h-11 sm:pb-3">
                {hasSuggestion && (
                  <Button className="flex-1" onClick={() => acceptMut.mutate({ batchId: selectedId! })} disabled={acceptMut.isPending}>
                    <ThumbsUp className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t("economyBatches.action.accept")}
                  </Button>
                )}
                {canReconcile && (
                  <Button variant={hasSuggestion ? "outline" : "default"} className="flex-1" onClick={() => { setRecBmId(null); setRecNotes(""); setRecOpen(true); }}>
                    <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t("economyBatches.action.reconcile")}
                  </Button>
                )}
                {detail.status === "difference" && (
                  <Button className="flex-1" onClick={() => { setJustifyText(""); setJustifyOpen(true); }}>
                    <FileCheck className="mr-1 h-4 w-4" aria-hidden="true" />
                    {t("economyBatches.action.justify")}
                  </Button>
                )}
                {menuItems.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label={t("economyBatches.action.more")}>
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {menuItems.map((m, i) => {
                        const Icon = m.icon;
                        return (
                          <div key={m.key}>
                            {m.danger && i > 0 && <DropdownMenuSeparator />}
                            <DropdownMenuItem onSelect={m.onSelect} className={cn("min-h-10", m.danger && "text-danger focus:text-danger")}>
                              <Icon className="mr-2 h-4 w-4" aria-hidden="true" /> {m.label}
                            </DropdownMenuItem>
                          </div>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </>
          )}
          {!detail && (
            <div className="p-4 text-sm text-muted-foreground" role="status">{detailQ.error ? t("economyBatches.loadError") : t("economyBatches.detail.loading")}</div>
          )}
        </SheetContent>
      </Sheet>

      {/* Generate dialog */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyBatches.generateDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyBatches.generateDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <FormField label={t("economyBatches.generateDialog.from")}>
              <Input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} />
            </FormField>
            <FormField label={t("economyBatches.generateDialog.to")}>
              <Input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} />
            </FormField>
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>{t("economyBatches.generateDialog.cancel")}</Button>
            <Button onClick={() => generateMut.mutate({ fromDate: genFrom, toDate: genTo })} disabled={generateMut.isPending || !genFrom || !genTo}>
              {generateMut.isPending ? t("economyBatches.generateDialog.submitting") : t("economyBatches.generateDialog.submit")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* Reconcile confirmation dialog */}
      <Dialog open={recOpen} onOpenChange={setRecOpen}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyBatches.reconcileDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyBatches.reconcileDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {recBmId == null && (
              <FormField label={t("economyBatches.reconcileDialog.bankId")}>
                <Input
                  type="number"
                  placeholder={t("economyBatches.reconcileDialog.bankIdPlaceholder")}
                  onChange={(e) => setRecBmId(parseInt(e.target.value) || null)}
                />
              </FormField>
            )}
            {recBmId && detail && (
              <div className="space-y-1 rounded bg-muted/60 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.reconcileDialog.net")}</span>
                  <span className="font-medium tabular-nums text-foreground">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.reconcileDialog.movement")}</span>
                  <span className="text-right text-foreground">
                    {chosenMovement ? <>{fmtDate(chosenMovement.fecha)} · <span className="tabular-nums">{fmt(chosenMovement.importe)}</span></> : t("economyBatches.reconcileDialog.movementId", { id: String(recBmId) })}
                  </span>
                </div>
                {chosenMovement?.movimiento && <div className="break-words text-xs text-muted-foreground">{chosenMovement.movimiento}</div>}
              </div>
            )}
            <FormField label={t("economyBatches.reconcileDialog.notes")}>
              <Textarea value={recNotes} onChange={(e) => setRecNotes(e.target.value)} placeholder={t("economyBatches.reconcileDialog.notesPlaceholder")} className="resize-none text-sm" rows={2} />
            </FormField>
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => setRecOpen(false)}>{t("economyBatches.reconcileDialog.cancel")}</Button>
            <Button
              onClick={() => {
                if (!selectedId || !recBmId) return;
                reconcileMut.mutate({ batchId: selectedId, bankMovementId: recBmId, notes: recNotes || undefined });
              }}
              disabled={reconcileMut.isPending || !recBmId}
            >
              {reconcileMut.isPending ? t("economyBatches.reconcileDialog.confirming") : t("economyBatches.reconcileDialog.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* Ignore dialog */}
      <Dialog open={ignOpen} onOpenChange={setIgnOpen}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyBatches.ignoreDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyBatches.ignoreDialog.description")}</DialogDescription>
          </DialogHeader>
          <FormField label={t("economyBatches.ignoreDialog.reason")}>
            <Textarea value={ignNotes} onChange={(e) => setIgnNotes(e.target.value)} placeholder={t("economyBatches.ignoreDialog.placeholder")} className="resize-none text-sm" rows={2} />
          </FormField>
          <FormFooter>
            <Button variant="outline" onClick={() => setIgnOpen(false)}>{t("economyBatches.ignoreDialog.cancel")}</Button>
            <Button
              onClick={() => {
                if (!selectedId) return;
                ignoreMut.mutate({ batchId: selectedId, notes: ignNotes || undefined });
              }}
              disabled={ignoreMut.isPending}
            >
              {ignoreMut.isPending ? t("economyBatches.ignoreDialog.saving") : t("economyBatches.ignoreDialog.submit")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* Delete operation dialog */}
      <Dialog open={delOpOpen} onOpenChange={(v) => { setDelOpOpen(v); if (!v) setDelOpTarget(null); }}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyBatches.removeOpDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyBatches.removeOpDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {delOpTarget && (
              <div className="space-y-1 rounded bg-muted/60 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.removeOpDialog.operation")}</span>
                  <span className="text-foreground">{t("economyBatches.detail.operationNo", { number: delOpTarget.operationNumber ?? "—" })}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.removeOpDialog.amount")}</span>
                  <span className="font-medium tabular-nums text-foreground">{fmt(delOpTarget.amount)}</span>
                </div>
              </div>
            )}
            {detail?.status === "reconciled" || detail?.status === "difference" ? (
              <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <span className="text-xs text-warning">{t("economyBatches.removeOpDialog.warning")}</span>
              </div>
            ) : null}
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => { setDelOpOpen(false); setDelOpTarget(null); }}>{t("economyBatches.removeOpDialog.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!selectedId || !delOpTarget) return;
                removeOpMut.mutate({ batchId: selectedId, batchOpId: delOpTarget.batchOpId });
              }}
              disabled={removeOpMut.isPending}
            >
              {removeOpMut.isPending ? t("economyBatches.removeOpDialog.deleting") : t("economyBatches.removeOpDialog.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* Justify difference dialog */}
      <Dialog open={justifyOpen} onOpenChange={setJustifyOpen}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-warning" aria-hidden="true" />
              {t("economyBatches.justifyDialog.title")}
            </DialogTitle>
            <DialogDescription>{t("economyBatches.justifyDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {detail?.differenceAmount && (
              <div className="space-y-1 rounded border border-warning/30 bg-warning/10 p-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.justifyDialog.net")}</span>
                  <span className="font-medium tabular-nums text-foreground">{fmt(detail.totalNet)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{t("economyBatches.justifyDialog.bank")}</span>
                  <span className="tabular-nums text-foreground">{fmt(detail.bankMovement?.importe)}</span>
                </div>
                <div className="flex justify-between gap-3 border-t border-warning/20 pt-1">
                  <span className="text-warning">{t("economyBatches.justifyDialog.difference")}</span>
                  <span className="font-semibold tabular-nums text-warning">{fmt(detail.differenceAmount)}</span>
                </div>
              </div>
            )}
            <FormField label={t("economyBatches.justifyDialog.label")} required hint={t("economyBatches.justifyDialog.min")}>
              <Textarea value={justifyText} onChange={(e) => setJustifyText(e.target.value)} placeholder={t("economyBatches.justifyDialog.placeholder")} className="resize-none text-sm" rows={3} />
            </FormField>
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => setJustifyOpen(false)}>{t("economyBatches.justifyDialog.cancel")}</Button>
            <Button
              onClick={() => {
                if (!selectedId || justifyText.trim().length < 5) return;
                justifyMut.mutate({ batchId: selectedId, justification: justifyText.trim() });
              }}
              disabled={justifyMut.isPending || justifyText.trim().length < 5}
            >
              {justifyMut.isPending ? t("economyBatches.justifyDialog.saving") : t("economyBatches.justifyDialog.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>
    </EconomyShell>
    </AdminLayout>
  );
}
