import { useState, useRef, useEffect } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { SummaryStrip, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { EconomyFilterBar, EconomyTable, FilterField, FormField, FormFooter, FormSection, RowActions, type EconomyColumn, type FilterChip, type RowAction } from "./shared/EconomyUi";
import { EconomyPager, InnerTabs } from "./shared/EconomyParts";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/errorMessage";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { isValidIsoDate } from "@/lib/isoDate";
import { cn } from "@/lib/utils";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../../components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import {
  Upload,
  Search,
  RefreshCw,
  Link,
  MoreHorizontal,
  Unlink,
  AlertTriangle,
  Eye,
  X,
  Trash2,
  Mail,
  FolderOpen,
} from "lucide-react";

const IMAP_ALLOWED_SENDER_LABEL = "copia@ticket.comerciaglobalpay.com";

type OpStatus = "pendiente" | "conciliado" | "incidencia" | "ignorado" | "todos";
type OpType = "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO" | "todos";

const STATUS_TONE: Record<string, Tone> = {
  pendiente: "warning",
  conciliado: "success",
  incidencia: "danger",
  ignorado: "neutral",
  included_in_batch: "info",
  settled: "success",
};
const TYPE_TONE: Record<string, Tone> = { VENTA: "info", DEVOLUCION: "warning", ANULACION: "danger", OTRO: "neutral" };
const STATUS_KEYS = ["pendiente", "conciliado", "incidencia", "ignorado"] as const;
const TYPE_KEYS = ["VENTA", "DEVOLUCION", "ANULACION", "OTRO"] as const;
const IMPORT_TABS = ["imports", "mail"] as const;
type ImportTab = (typeof IMPORT_TABS)[number];

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function CardTerminalOperationsManager() {
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();
  const utils = trpc.useUtils();

  // Filters
  const [statusFilter, setStatusFilter] = useState<OpStatus>("todos");
  const [typeFilter, setTypeFilter] = useState<OpType>("todos");
  const [searchInput, setSearchInput] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("search") ?? ""; } catch { return ""; }
  });
  const [search, setSearch] = useState(searchInput.trim());
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // La búsqueda viaja al servidor (con un pequeño retardo al teclear)
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch((prev) => (prev === searchInput.trim() ? prev : searchInput.trim()));
    }, 350);
    return () => clearTimeout(id);
  }, [searchInput]);
  useEffect(() => { setPage(0); }, [search]);

  // Import
  const [showImportModal, setShowImportModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    importedRows: number;
    duplicatesSkipped: number;
    autoLinked: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
  const [detailId, setDetailId] = useState<number | null>(null);

  // Link manual modal
  const [linkModalId, setLinkModalId] = useState<number | null>(null);
  const [linkModalAmount, setLinkModalAmount] = useState<number | null>(null);
  // Tipo de la operación que se está vinculando. Se pasa al endpoint para
  // que DEVOLUCION/ANULACION puedan vincularse a reservas ya enlazadas
  // (caso real: una devolución del datáfono se vincula a la reserva
  // original que ya tiene su venta enlazada).
  const [linkModalOpType, setLinkModalOpType] = useState<"VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO" | null>(null);
  const [linkEntityType, setLinkEntityType] = useState<"reservation" | "quote">("reservation");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkSelectedId, setLinkSelectedId] = useState<number | null>(null);
  const [linkNotes, setLinkNotes] = useState("");

  const resetLinkModal = () => {
    setLinkModalId(null);
    setLinkModalAmount(null);
    setLinkModalOpType(null);
    setLinkSearch("");
    setLinkSelectedId(null);
    setLinkNotes("");
  };

  // Incident modal
  const [incidentId, setIncidentId] = useState<number | null>(null);
  const [incidentReason, setIncidentReason] = useState("");

  // Unlink modal
  const [unlinkId, setUnlinkId] = useState<number | null>(null);
  const [unlinkNotes, setUnlinkNotes] = useState("");

  // Delete import modal
  const [deleteImportId, setDeleteImportId] = useState<number | null>(null);

  // Reprocesar fecha
  const [reprocessOpen, setReprocessOpen] = useState(false);
  const [reprocessDate, setReprocessDate] = useState(todayIso);
  const [reprocessTouched, setReprocessTouched] = useState(false);
  const reprocessInvalid = !isValidIsoDate(reprocessDate);

  // Importaciones y correo
  const [importsOpen, setImportsOpen] = useState(false);
  const [importsTab, setImportsTab] = useState<ImportTab>("imports");

  // Email sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    messagesChecked: number;
    messagesProcessed: number;
    operationsDetected: number;
    operationsInserted: number;
    operationsDuplicate: number;
    operationsLinked: number;
    operationsFailed: number;
    errors: string[];
  } | null>(null);

  // Queries: el listado y el resumen comparten el mismo filtro (el resumen es el del conjunto completo, no el de la página)
  const baseFilter = {
    operationType: typeFilter,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };
  const listQ = trpc.cardTerminalOperations.list.useQuery(
    { ...baseFilter, status: statusFilter, page: page + 1, pageSize },
    { refetchOnWindowFocus: false }
  );
  const summaryQ = trpc.cardTerminalOperations.summary.useQuery(
    { ...baseFilter, status: statusFilter },
    { refetchOnWindowFocus: false }
  );

  const importsQ = trpc.cardTerminalOperations.listImports.useQuery(undefined, { refetchOnWindowFocus: false, enabled: importsOpen });

  const emailLogsQ = trpc.emailIngestion.listLogs.useQuery(
    { limit: 50 },
    { enabled: importsOpen && importsTab === "mail", refetchOnWindowFocus: false }
  );

  const detailQ = trpc.cardTerminalOperations.getById.useQuery(
    { id: detailId! },
    { enabled: detailId !== null }
  );

  const unlinkedResQ = trpc.cardTerminalOperations.searchUnlinkedReservations.useQuery(
    {
      search: linkSearch,
      amountEur: linkModalAmount ?? undefined,
      operationType: linkModalOpType ?? undefined,
    },
    { enabled: linkModalId !== null && linkEntityType === "reservation" }
  );

  const invalidateLists = () => {
    utils.cardTerminalOperations.list.invalidate();
    utils.cardTerminalOperations.summary.invalidate();
  };

  // Mutations
  const importMut = trpc.cardTerminalOperations.importExcel.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      invalidateLists();
      utils.cardTerminalOperations.listImports.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const linkMut = trpc.cardTerminalOperations.linkManually.useMutation({
    onSuccess: () => {
      invalidateLists();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      resetLinkModal();
    },
    onError: (e) => toastError(e),
  });

  const incidentMut = trpc.cardTerminalOperations.markIncident.useMutation({
    onSuccess: () => {
      invalidateLists();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      setIncidentId(null);
      setIncidentReason("");
    },
    onError: (e) => toastError(e),
  });

  const unlinkMut = trpc.cardTerminalOperations.unlink.useMutation({
    onSuccess: () => {
      invalidateLists();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      setUnlinkId(null);
      setUnlinkNotes("");
    },
    onError: (e) => toastError(e),
  });

  const updateStatusMut = trpc.cardTerminalOperations.updateStatus.useMutation({
    onSuccess: () => {
      invalidateLists();
    },
    onError: (e) => toastError(e),
  });

  const deleteImportMut = trpc.cardTerminalOperations.deleteImport.useMutation({
    onSuccess: () => {
      invalidateLists();
      utils.cardTerminalOperations.listImports.invalidate();
      setDeleteImportId(null);
    },
    onError: (e) => toastError(e),
  });

  const syncEmailMut = trpc.emailIngestion.triggerSync.useMutation({
    onSuccess: (data) => {
      setSyncResult(data);
      invalidateLists();
      utils.emailIngestion.listLogs.invalidate();
    },
    onError: (e) => toastError(e),
    onSettled: () => setSyncing(false),
  });

  const resetLogsMut = trpc.emailIngestion.resetLogsForDate.useMutation({
    onSuccess: (data) => {
      utils.emailIngestion.listLogs.invalidate();
      toast.success(t("economyPos.reprocessDialog.toast", { count: data.reset }));
      setReprocessOpen(false);
    },
    onError: (e) => toastError(e),
  });

  const repairStatusMut = trpc.cardTerminalOperations.repairLinkedStatus.useMutation({
    onSuccess: (data) => {
      invalidateLists();
      toast.success(t("economyPos.repairToast", { count: data.fixed }));
    },
    onError: (e) => toastError(e),
  });

  // Handlers
  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...Array.from(new Uint8Array(buffer))));
      await importMut.mutateAsync({
        fileName: file.name,
        fileType: file.name.split(".").pop()?.toLowerCase() ?? "xlsx",
        fileBase64: base64,
      });
    } catch {
      // el aviso de error ya lo muestra la mutación
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resetFilters() {
    setStatusFilter("todos");
    setTypeFilter("todos");
    setSearchInput("");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  }

  function openReprocess() {
    setReprocessDate(todayIso());
    setReprocessTouched(false);
    setReprocessOpen(true);
  }
  function submitReprocess() {
    setReprocessTouched(true);
    if (!isValidIsoDate(reprocessDate)) return;
    resetLogsMut.mutate({ date: reprocessDate });
  }

  const ops = listQ.data?.data ?? [];
  const total = listQ.data?.total ?? 0;
  const summary = summaryQ.data;

  type Op = (typeof ops)[number];
  const fmtDatetime = (v: string | Date | null | undefined) => (v ? f.dateTime(new Date(v), { dateStyle: "short", timeStyle: "short" }) : "-");
  const dateChip = (v: string) => f.date(new Date(`${v}T00:00:00`));
  const statusLabel = (s: string) => (s in STATUS_TONE ? t(`economyPos.status.${s}`) : s);
  const typeLabel = (s: string) => (s in TYPE_TONE ? t(`economyPos.type.${s}`) : s);
  const chips: FilterChip[] = [
    ...(search ? [{ id: "q", label: t("economyPos.chip.search", { value: search }), onRemove: () => { setSearchInput(""); setSearch(""); setPage(0); } }] : []),
    ...(statusFilter !== "todos" ? [{ id: "status", label: t("economyPos.chip.status", { value: statusLabel(statusFilter) }), onRemove: () => { setStatusFilter("todos"); setPage(0); } }] : []),
    ...(typeFilter !== "todos" ? [{ id: "type", label: t("economyPos.chip.type", { value: typeLabel(typeFilter) }), onRemove: () => { setTypeFilter("todos"); setPage(0); } }] : []),
    ...(dateFrom ? [{ id: "from", label: t("economyPos.chip.from", { value: dateChip(dateFrom) }), onRemove: () => { setDateFrom(""); setPage(0); } }] : []),
    ...(dateTo ? [{ id: "to", label: t("economyPos.chip.to", { value: dateChip(dateTo) }), onRemove: () => { setDateTo(""); setPage(0); } }] : []),
  ];

  const toggleStatus = (s: "pendiente" | "incidencia") => {
    setStatusFilter((cur) => (cur === s ? "todos" : s));
    setPage(0);
  };
  const dash = "—";
  const stripItems: SummaryStripItem[] = [
    {
      key: "net",
      label: t("economyPos.summary.net"),
      value: summary ? money.eur(summary.neto) : dash,
      detail: summary ? (
        <>
          <span className="sm:max-lg:hidden">{t("economyPos.summary.netDetail", { count: summary.count })}</span>
          <span className="hidden 2xl:inline"> · {t("economyPos.summary.netBreakdown", { sales: money.eur(summary.ventas), refunds: money.eur(summary.devoluciones) })}</span>
        </>
      ) : undefined,
      primary: true,
      tone: summary && Number(summary.neto) < 0 ? "danger" : "success",
    },
    {
      key: "pending",
      label: t("economyPos.summary.pending"),
      value: summary ? String(summary.byStatus.pendiente) : dash,
      tone: summary && summary.byStatus.pendiente > 0 ? "warning" : "success",
      onClick: () => toggleStatus("pendiente"),
      active: statusFilter === "pendiente",
    },
    {
      key: "incidents",
      label: t("economyPos.summary.incidents"),
      value: summary ? String(summary.byStatus.incidencia) : dash,
      tone: summary && summary.byStatus.incidencia > 0 ? "danger" : "success",
      onClick: () => toggleStatus("incidencia"),
      active: statusFilter === "incidencia",
    },
  ];

  const statusBadge = (s: string) => <StatusBadge tone={STATUS_TONE[s] ?? "neutral"}>{statusLabel(s)}</StatusBadge>;
  const typeBadge = (s: string) => <StatusBadge tone={TYPE_TONE[s] ?? "neutral"}>{typeLabel(s)}</StatusBadge>;
  const amountOf = (op: Op) => (
    <span className={cn("whitespace-nowrap font-semibold tabular-nums", op.operationType === "DEVOLUCION" ? "text-warning" : "text-success")}>{money.eur(op.amount)}</span>
  );
  const linkedOf = (op: Op) =>
    op.linkedEntityType && op.linkedEntityType !== "none" ? (
      op.linkedEntityType === "reservation" ? (
        <a
          href={`/admin/crm?tab=reservations&search=${encodeURIComponent((op as any).linkedReservationNumber ?? String(op.linkedEntityId))}`}
          className="text-xs font-medium text-info hover:text-info hover:underline"
        >
          {(op as any).linkedReservationNumber ?? `#${op.linkedEntityId}`}
        </a>
      ) : (
        <span className="text-xs font-medium text-warning">{t("economyPos.quoteRef", { id: String(op.linkedEntityId) })}</span>
      )
    ) : null;

  const columns: EconomyColumn<Op>[] = [
    {
      key: "fecha",
      header: t("economyPos.col.date"),
      mobile: "title",
      cell: (op) => (
        <>
          <span className="whitespace-nowrap">{fmtDatetime(op.operationDatetime)}</span>
          <span className="mt-0.5 block font-mono text-xs font-normal text-muted-foreground">{op.operationNumber || "-"}</span>
        </>
      ),
    },
    { key: "terminal", header: t("economyPos.col.terminal"), priority: "xl", cell: (op) => <span className="text-xs text-muted-foreground">{op.terminalCode || "-"}</span> },
    { key: "tipo", header: t("economyPos.col.type"), cell: (op) => typeBadge(op.operationType) },
    { key: "importe", header: t("economyPos.col.amount"), align: "right", num: true, mobile: "amount", cell: amountOf },
    { key: "tarjeta", header: t("economyPos.col.card"), priority: "lg", cell: (op) => <span className="font-mono text-xs">{op.card ? `****${op.card.slice(-4)}` : "-"}</span> },
    { key: "estado", header: t("economyPos.col.state"), cell: (op) => statusBadge(op.status) },
    { key: "link", header: t("economyPos.col.linked"), priority: "md", cell: (op) => linkedOf(op) ?? <span className="text-xs text-muted-foreground">—</span> },
  ];

  const rowActions = (op: Op) => {
    const openLink = () => { setLinkModalId(op.id); setLinkModalAmount(parseFloat(op.amount)); setLinkModalOpType((op as any).operation_type ?? (op as any).operationType ?? null); };
    const menu: RowAction[] = [{ label: t("economyPos.action.view"), icon: <Eye />, onSelect: () => setDetailId(op.id) }];
    if (op.status === "pendiente") menu.push({ label: t("economyPos.action.ignore"), icon: <X />, onSelect: () => updateStatusMut.mutate({ id: op.id, status: "ignorado" }) });
    if (op.status !== "incidencia" && op.status !== "conciliado") menu.push({ label: t("economyPos.action.incident"), icon: <AlertTriangle />, destructive: true, onSelect: () => setIncidentId(op.id) });
    return (
      <RowActions
        label={op.operationNumber || fmtDatetime(op.operationDatetime)}
        primary={
          op.status === "conciliado"
            ? { label: t("economyPos.action.unlink"), icon: <Unlink className="h-4 w-4" />, onSelect: () => setUnlinkId(op.id) }
            : { label: t("economyPos.action.link"), icon: <Link className="h-4 w-4" />, onSelect: openLink }
        }
        menu={menu}
      />
    );
  };

  const syncStat = (label: string, value: number, cls?: string) => (
    <span>{label}: <b className={cls}>{value}</b></span>
  );

  return (
    <AdminLayout>
      <EconomyShell screen="pos"
        description={t("economyPos.description")}
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => { void listQ.refetch(); void summaryQ.refetch(); }}>
              <RefreshCw className="w-4 h-4 mr-1" aria-hidden="true" /> {t("economyPos.refresh")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label={t("economyPos.moreAria")}>
                  <MoreHorizontal className="w-4 h-4 mr-1" aria-hidden="true" /> {t("economyPos.more")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => { setImportsTab("imports"); setImportsOpen(true); }}>
                  <FolderOpen className="mr-2 h-4 w-4" aria-hidden="true" /> {t("economyPos.importsMail")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={syncing}
                  onSelect={() => {
                    setSyncing(true);
                    setSyncResult(null);
                    syncEmailMut.mutate({ retryErrors: false });
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" /> {syncing ? t("economyPos.syncing") : t("economyPos.syncMail")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openReprocess}>
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> {t("economyPos.reprocess")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    if ((await confirmAction({ description: t("economyPos.repairConfirm") }))) {
                      repairStatusMut.mutate();
                    }
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" /> {t("economyPos.repair")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => { setShowImportModal(true); setImportResult(null); }}>
              <Upload className="w-4 h-4 mr-1" aria-hidden="true" /> {t("economyPos.import")}
            </Button>
          </>
        }>
    <div className="space-y-4">

      {/* Email sync result */}
      {syncResult && (
        <div role="status" className={`rounded-lg border p-4 text-sm ${syncResult.errors.length > 0 ? "bg-danger/10 border-danger/40" : "bg-success/10 border-success/40"}`}>
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {syncResult.errors.length > 0 ? t("economyPos.sync.withErrors") : t("economyPos.sync.ok")}
            </div>
            <button type="button" onClick={() => setSyncResult(null)} aria-label={t("economyPos.sync.close")} className="inline-flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground sm:h-8 sm:w-8">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-1 text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {syncStat(t("economyPos.sync.checked"), syncResult.messagesChecked)}
            {syncStat(t("economyPos.sync.processed"), syncResult.messagesProcessed)}
            {syncStat(t("economyPos.sync.detected"), syncResult.operationsDetected)}
            {syncStat(t("economyPos.sync.inserted"), syncResult.operationsInserted, "text-success")}
            {syncStat(t("economyPos.sync.linked"), syncResult.operationsLinked, "text-info")}
            {syncStat(t("economyPos.sync.duplicates"), syncResult.operationsDuplicate)}
            {syncResult.operationsFailed > 0 && syncStat(t("economyPos.sync.failed"), syncResult.operationsFailed, "text-danger")}
          </div>
          {syncResult.errors.length > 0 && (
            <ul className="mt-2 text-danger list-disc list-inside">
              {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Resumen del filtro completo: neto + filtros rápidos */}
      <SummaryStrip items={stripItems} label={t("economyPos.summary.label")} />

      {/* Filtros */}
      <EconomyFilterBar
        search={{ value: searchInput, onChange: setSearchInput, placeholder: t("economyPos.filter.search") }}
        primary={
          <>
            <FilterField label={t("economyPos.filter.status")} className="w-full sm:w-40">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as OpStatus); setPage(0); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">{t("economyPos.filter.all")}</SelectItem>
                  {STATUS_KEYS.map((s) => <SelectItem key={s} value={s}>{t(`economyPos.status.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label={t("economyPos.filter.type")} className="w-full sm:w-40">
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as OpType); setPage(0); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">{t("economyPos.filter.all")}</SelectItem>
                  {TYPE_KEYS.map((s) => <SelectItem key={s} value={s}>{t(`economyPos.type.${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterField>
          </>
        }
        more={
          <>
            <FilterField label={t("economyPos.filter.from")}>
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} />
            </FilterField>
            <FilterField label={t("economyPos.filter.to")}>
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} />
            </FilterField>
          </>
        }
        chips={chips}
        onClear={resetFilters}
        summary={t("economyPos.resultCount", { count: total })}
      />

      {/* Tabla */}
      <EconomyTable
        rows={ops}
        columns={columns}
        rowKey={(op) => op.id}
        caption={t("economyPos.caption")}
        loading={listQ.isLoading}
        error={listQ.error}
        errorTitle={t("economyPos.loadError")}
        onRetry={() => void listQ.refetch()}
        emptyTitle={t("economyPos.empty.title")}
        emptyDescription={t("economyPos.empty.description")}
        emptyAction={chips.length > 0 ? <Button variant="outline" size="sm" className="max-sm:h-10" onClick={resetFilters}>{t("economyPos.empty.clear")}</Button> : undefined}
        onRowClick={(op) => setDetailId(op.id)}
        actions={rowActions}
        mobileCard={(op, menu) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words font-medium text-foreground">{fmtDatetime(op.operationDatetime)}</span>
              <span className="shrink-0 text-sm">{amountOf(op)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {typeBadge(op.operationType)}
              {statusBadge(op.status)}
              <span className="font-mono text-xs text-muted-foreground">{op.card ? `****${op.card.slice(-4)}` : ""}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground">
                {op.operationNumber || "-"}
                {linkedOf(op) && <> · {linkedOf(op)}</>}
              </span>
              {menu}
            </div>
          </div>
        )}
        footer={<EconomyPager page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0); }} />}
      />

      {/* ── Importaciones y correo: panel lateral, fuera de la lista ── */}
      <Sheet open={importsOpen} onOpenChange={setImportsOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
          <SheetHeader className="space-y-1 border-b border-border p-4 pr-12">
            <SheetTitle className="text-base">{t("economyPos.imports.title")}</SheetTitle>
            <SheetDescription>{t("economyPos.imports.description")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <InnerTabs
              tabs={[
                { key: "imports", label: t("economyPos.imports.tabImports") },
                { key: "mail", label: t("economyPos.imports.tabMail") },
              ]}
              active={importsTab}
              onChange={setImportsTab}
              label={t("economyPos.imports.tabsLabel")}
            />
            {importsTab === "imports" && (
              <div className="space-y-2">
                {importsQ.isLoading && <p className="text-sm text-muted-foreground">{t("economyPos.imports.mailLoading")}</p>}
                {!importsQ.isLoading && (importsQ.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">{t("economyPos.imports.emptyImports")}</p>}
                {(importsQ.data ?? []).map((imp) => (
                  <div key={imp.id} className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p className="break-all font-medium text-foreground">{imp.fileName}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{f.date(new Date(imp.createdAt))}</span>
                        <StatusBadge tone={imp.status === "ok" ? "success" : "danger"}>{imp.status === "ok" ? t("economyPos.imports.rows", { count: imp.importedRows }) : t("economyPos.imports.error")}</StatusBadge>
                        {imp.duplicatesSkipped > 0 && <span>{t("economyPos.imports.dups", { count: imp.duplicatesSkipped })}</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-danger hover:text-danger sm:h-8 sm:w-8" aria-label={t("economyPos.deleteImport.aria", { name: imp.fileName })} onClick={() => setDeleteImportId(imp.id)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {importsTab === "mail" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t("economyPos.imports.mailSummary", { count: emailLogsQ.data?.length ?? 0, sender: IMAP_ALLOWED_SENDER_LABEL })}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="max-sm:h-10"
                    disabled={syncing}
                    onClick={() => {
                      setSyncing(true);
                      setSyncResult(null);
                      syncEmailMut.mutate({ retryErrors: true });
                    }}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> {t("economyPos.imports.retry")}
                  </Button>
                </div>
                {emailLogsQ.isLoading ? (
                  <p className="text-sm text-muted-foreground">{t("economyPos.imports.mailLoading")}</p>
                ) : (emailLogsQ.data?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("economyPos.imports.mailNone")}</p>
                ) : (
                  <ul className="space-y-2">
                    {emailLogsQ.data!.map((log) => (
                      <li key={log.id} className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-xs">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words text-sm font-medium text-foreground">{log.subject || t("economyPos.imports.noSubject")}</span>
                          <StatusBadge tone={log.status === "ok" ? "success" : log.status === "error" ? "danger" : "neutral"}>{log.status}</StatusBadge>
                        </div>
                        <p className="text-muted-foreground">
                          {fmtDatetime(log.createdAt)}
                          {log.parsingStrategy ? ` · ${log.parsingStrategy}` : ""}
                        </p>
                        <p className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-muted-foreground">
                          <span>{t("economyPos.imports.detected", { n: log.operationsDetected ?? 0 })}</span>
                          <span className="text-success">{t("economyPos.imports.inserted", { n: log.operationsInserted })}</span>
                          <span className="text-info">{t("economyPos.imports.linked", { n: log.operationsLinked ?? 0 })}</span>
                          <span>{t("economyPos.imports.duplicate", { n: log.operationsDuplicate })}</span>
                          <span className="text-danger">{t("economyPos.imports.failed", { n: log.operationsFailed ?? 0 })}</span>
                          <span>{t("economyPos.imports.retries", { n: log.retryCount ?? 0 })}</span>
                        </p>
                        {log.errorMessage && <p className="break-words text-danger">{log.errorMessage}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Reprocesar fecha ── */}
      <Dialog open={reprocessOpen} onOpenChange={setReprocessOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.reprocessDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyPos.reprocessDialog.description")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(e) => { e.preventDefault(); submitReprocess(); }}
          >
            <FormField label={t("economyPos.reprocessDialog.date")} required error={reprocessTouched && reprocessInvalid ? t("economyPos.reprocessDialog.invalid") : null}>
              <Input
                type="date"
                value={reprocessDate}
                onChange={(e) => setReprocessDate(e.target.value)}
                aria-invalid={reprocessTouched && reprocessInvalid}
                className="max-sm:h-11"
              />
            </FormField>
            <FormFooter>
              <Button type="button" variant="outline" onClick={() => setReprocessOpen(false)}>{t("economyPos.reprocessDialog.cancel")}</Button>
              <Button type="submit" disabled={resetLogsMut.isPending}>
                {resetLogsMut.isPending ? t("economyPos.reprocessDialog.submitting") : t("economyPos.reprocessDialog.submit")}
              </Button>
            </FormFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Import Modal ── */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.importDialog.title")}</DialogTitle>
            <DialogDescription>{t("economyPos.importDialog.help")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!importResult ? (
              <button
                type="button"
                className="block w-full border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? (
                  <div className="space-y-2">
                    <RefreshCw className="w-8 h-8 mx-auto animate-spin text-primary" aria-hidden="true" />
                    <p className="text-sm">{t("economyPos.importDialog.processing")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium">{t("economyPos.importDialog.drop")}</p>
                    <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv</p>
                  </div>
                )}
              </button>
            ) : (
              <div className="bg-success/10 border border-success/40 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-success">{t("economyPos.importDialog.done")}</p>
                <p className="text-sm text-success">{t("economyPos.importDialog.rows", { count: importResult.importedRows })}</p>
                {importResult.duplicatesSkipped > 0 && (
                  <p className="text-sm text-muted-foreground">{t("economyPos.importDialog.dups", { count: importResult.duplicatesSkipped })}</p>
                )}
                {importResult.autoLinked > 0 && (
                  <p className="text-sm text-info">{t("economyPos.importDialog.auto", { count: importResult.autoLinked })}</p>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              aria-label={t("economyPos.import")}
              onChange={handleFileImport}
            />
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => setShowImportModal(false)}>{t("economyPos.importDialog.close")}</Button>
            {importResult && (
              <Button onClick={() => { setImportResult(null); fileInputRef.current?.click(); }}>
                {t("economyPos.importDialog.another")}
              </Button>
            )}
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Modal ── */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.detail.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("economyPos.detail.title")}</DialogDescription>
          </DialogHeader>
          {detailQ.data ? (
            <div className="space-y-4 text-sm">
              <FormSection title={t("economyPos.detail.operation")}>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.date")}</p><p className="font-medium">{fmtDatetime(detailQ.data.operationDatetime)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.number")}</p><p className="break-all font-mono">{detailQ.data.operationNumber || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.amount")}</p><p className="font-bold text-lg tabular-nums">{money.eur(detailQ.data.amount)}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.type")}</p>{typeBadge(detailQ.data.operationType)}</div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.card")}</p><p className="font-mono">{detailQ.data.card ? `****${detailQ.data.card.slice(-4)}` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.auth")}</p><p className="font-mono">{detailQ.data.authorizationCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.terminal")}</p><p>{detailQ.data.terminalCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.commerce")}</p><p>{detailQ.data.commerceCode || "-"}</p></div>
              </div>
              </FormSection>
              <FormSection title={t("economyPos.detail.stateSection")}>
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.state")}</p>{statusBadge(detailQ.data.status)}</div>
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.linkedTo")}</p>
                  <p>{detailQ.data.linkedEntityType && detailQ.data.linkedEntityType !== "none"
                    ? t(detailQ.data.linkedEntityType === "reservation" ? "economyPos.detail.reservation" : "economyPos.detail.quote", { id: String(detailQ.data.linkedEntityId) })
                    : "—"}</p>
                </div>
                {detailQ.data.linkedAt && (
                  <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.linkedOn")}</p><p>{fmtDatetime(detailQ.data.linkedAt)}</p></div>
                )}
                {detailQ.data.linkedBy && (
                  <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.linkedBy")}</p><p>{detailQ.data.linkedBy}</p></div>
                )}
              </div>
              </FormSection>
              {detailQ.data.incidentReason && (
                <div className="bg-danger/10 border border-danger/40 rounded p-3">
                  <p className="text-xs text-danger font-medium mb-1">{t("economyPos.detail.incidentReason")}</p>
                  <p className="text-sm">{detailQ.data.incidentReason}</p>
                </div>
              )}
              {detailQ.data.notes && (
                <div><p className="text-xs text-muted-foreground">{t("economyPos.detail.notes")}</p><p>{detailQ.data.notes}</p></div>
              )}
              <FormFooter className="flex-row flex-wrap sm:justify-start max-sm:[&>button]:w-auto max-sm:[&>button]:flex-1">
                {detailQ.data.status !== "conciliado" && (
                  <Button variant="outline" onClick={() => { setLinkModalId(detailId); setLinkModalAmount(detailQ.data ? parseFloat(detailQ.data.amount) : null); setLinkModalOpType(detailQ.data ? ((detailQ.data as any).operation_type ?? (detailQ.data as any).operationType ?? null) : null); setDetailId(null); }}>
                    <Link className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {t("economyPos.action.link")}
                  </Button>
                )}
                {detailQ.data.status === "conciliado" && (
                  <Button variant="outline" className="text-warning" onClick={() => { setUnlinkId(detailId); setDetailId(null); }}>
                    <Unlink className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {t("economyPos.action.unlink")}
                  </Button>
                )}
                {detailQ.data.status !== "incidencia" && detailQ.data.status !== "conciliado" && (
                  <Button variant="outline" className="text-danger" onClick={() => { setIncidentId(detailId); setDetailId(null); }}>
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> {t("economyPos.detail.incidentShort")}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setDetailId(null)}>{t("economyPos.detail.close")}</Button>
              </FormFooter>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">{t("economyPos.detail.loading")}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Link Manual Modal ── */}
      <Dialog open={linkModalId !== null} onOpenChange={(o) => { if (!o) resetLinkModal(); }}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.link.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("economyPos.link.title")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{t("economyPos.link.entityType")}</Label>
              <Select value={linkEntityType} onValueChange={(v) => { setLinkEntityType(v as "reservation" | "quote"); setLinkSelectedId(null); setLinkSearch(""); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reservation">{t("economyPos.link.reservation")}</SelectItem>
                  <SelectItem value="quote">{t("economyPos.link.quote")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {linkEntityType === "reservation" ? (
              <div className="space-y-2">
                <Label>{t("economyPos.link.searchLabel")}</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <Input
                    className="pl-8"
                    placeholder={t("economyPos.link.searchPlaceholder")}
                    value={linkSearch}
                    onChange={(e) => { setLinkSearch(e.target.value); setLinkSelectedId(null); }}
                  />
                </div>
                {linkModalAmount !== null && !linkSearch && (
                  <p className="text-xs text-muted-foreground">
                    {linkModalOpType === "DEVOLUCION" || linkModalOpType === "ANULACION"
                      ? t("economyPos.link.hintRefund", { kind: t(`economyPos.link.kind.${linkModalOpType}`) })
                      : t("economyPos.link.hintAmount", { amount: money.eur(linkModalAmount) })}
                  </p>
                )}
                <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                  {unlinkedResQ.isLoading && (
                    <p className="text-xs text-muted-foreground p-3">{t("economyPos.link.searching")}</p>
                  )}
                  {!unlinkedResQ.isLoading && (unlinkedResQ.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground p-3">{t("economyPos.link.none")}</p>
                  )}
                  {(unlinkedResQ.data ?? []).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`w-full min-h-11 text-left px-3 py-2 text-sm flex justify-between items-center gap-2 hover:bg-muted transition-colors ${linkSelectedId === r.id ? "bg-primary/10 font-medium" : ""}`}
                      onClick={() => setLinkSelectedId(r.id)}
                    >
                      <span className="min-w-0 break-words">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{r.reservationNumber}</span>
                        {r.customerName}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2 tabular-nums">
                        {money.eur(r.amountTotal / 100)} · {r.bookingDate}
                      </span>
                    </button>
                  ))}
                </div>
                {linkSelectedId && (
                  <p className="text-xs text-success">
                    {t("economyPos.link.selected", { id: String(linkSelectedId) })}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label>{t("economyPos.link.quoteId")}</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder={t("economyPos.link.quotePlaceholder")}
                  value={linkSelectedId ?? ""}
                  onChange={(e) => setLinkSelectedId(e.target.value ? parseInt(e.target.value) : null)}
                />
              </div>
            )}

            <div>
              <Label>{t("economyPos.link.notes")}</Label>
              <Textarea className="mt-1" rows={2} value={linkNotes} onChange={(e) => setLinkNotes(e.target.value)} />
            </div>
          </div>
          <FormFooter>
            <Button variant="outline" onClick={resetLinkModal}>{t("economyPos.link.cancel")}</Button>
            <Button
              disabled={!linkSelectedId || linkMut.isPending}
              onClick={() => {
                if (!linkModalId || !linkSelectedId) return;
                linkMut.mutate({
                  id: linkModalId,
                  entityType: linkEntityType,
                  entityId: linkSelectedId,
                  notes: linkNotes || undefined,
                });
              }}
            >
              {linkMut.isPending ? t("economyPos.link.submitting") : t("economyPos.link.submit")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* ── Incident Modal ── */}
      <Dialog open={incidentId !== null} onOpenChange={(o) => { if (!o) { setIncidentId(null); setIncidentReason(""); } }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.incident.title")}</DialogTitle>
            <DialogDescription className="sr-only">{t("economyPos.incident.title")}</DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t("economyPos.incident.reason")}</Label>
            <Textarea
              className="mt-1"
              rows={3}
              placeholder={t("economyPos.incident.placeholder")}
              value={incidentReason}
              onChange={(e) => setIncidentReason(e.target.value)}
            />
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => { setIncidentId(null); setIncidentReason(""); }}>{t("economyPos.incident.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={!incidentReason.trim() || incidentMut.isPending}
              onClick={() => {
                if (!incidentId || !incidentReason.trim()) return;
                incidentMut.mutate({ id: incidentId, reason: incidentReason.trim() });
              }}
            >
              {incidentMut.isPending ? t("economyPos.incident.saving") : t("economyPos.incident.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unlink Modal ── */}
      <Dialog open={unlinkId !== null} onOpenChange={(o) => { if (!o) { setUnlinkId(null); setUnlinkNotes(""); } }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.unlink.title")}</DialogTitle>
            <DialogDescription>{t("economyPos.unlink.body")}</DialogDescription>
          </DialogHeader>
          <div>
            <Label>{t("economyPos.unlink.reason")}</Label>
            <Textarea className="mt-1" rows={2} value={unlinkNotes} onChange={(e) => setUnlinkNotes(e.target.value)} />
          </div>
          <FormFooter>
            <Button variant="outline" onClick={() => { setUnlinkId(null); setUnlinkNotes(""); }}>{t("economyPos.unlink.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={unlinkMut.isPending}
              onClick={() => {
                if (!unlinkId) return;
                unlinkMut.mutate({ id: unlinkId, notes: unlinkNotes || undefined });
              }}
            >
              {unlinkMut.isPending ? t("economyPos.unlink.saving") : t("economyPos.unlink.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Import Modal ── */}
      <Dialog open={deleteImportId !== null} onOpenChange={(o) => { if (!o) setDeleteImportId(null); }}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("economyPos.deleteImport.title")}</DialogTitle>
            <DialogDescription>{t("economyPos.deleteImport.body")}</DialogDescription>
          </DialogHeader>
          <FormFooter>
            <Button variant="outline" onClick={() => setDeleteImportId(null)}>{t("economyPos.deleteImport.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={deleteImportMut.isPending}
              onClick={() => {
                if (!deleteImportId) return;
                deleteImportMut.mutate({ id: deleteImportId });
              }}
            >
              {deleteImportMut.isPending ? t("economyPos.deleteImport.deleting") : t("economyPos.deleteImport.confirm")}
            </Button>
          </FormFooter>
        </DialogContent>
      </Dialog>
    </div>
    </EconomyShell>
    </AdminLayout>
  );
}
