import { useState, useRef, useCallback, useMemo } from "react";
import { Link } from "wouter";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { CompactEmpty, SCROLL_NAV, SummaryStrip, TAB_BASE, TAB_OFF, TAB_ON, ToolbarRow, useScrollFade, type SummaryStripItem } from "@/components/admin/SalesFamilyShell";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { FormFooter, EconomyTable, FilterField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { EconomyPager, MoreFilters, useUrlParam } from "./shared/EconomyParts";
import { trpc } from "@/lib/trpc";
import { toastError } from "@/lib/errorMessage";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { useMoney } from "@/lib/useMoney";
import { cn } from "@/lib/utils";
import { FINANCE_SYNC_SETUP_PATH } from "@shared/financeSyncSetup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, Trash2, Eye, FileSpreadsheet, RefreshCw, CheckCircle, MinusCircle, AlertCircle,
  Link2, Link2Off, Sparkles, ThumbsDown, Info, Rocket, SearchX,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type BankImport = {
  id: number;
  fileName: string;
  fileType: string;
  importedRows: number;
  duplicatesSkipped: number;
  status: "ok" | "error" | "parcial";
  errorMessage: string | null;
  createdAt: string;
};

type BankMovement = {
  id: number;
  importId: number;
  fecha: string;
  fechaValor: string | null;
  movimiento: string | null;
  masDatos: string | null;
  importe: string;
  saldo: string | null;
  duplicateKey: string;
  status: "pendiente" | "ignorado";
  conciliationStatus: "pendiente" | "conciliado";
  notes: string | null;
  createdAt: string;
};

type QuoteMatch = {
  quoteId: number;
  quoteNumber: string;
  title: string;
  total: number;
  status: string;
  sentAt: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  confidenceScore: number;
  isRejected: boolean;
};

type BankMovementLink = {
  id: number;
  bankMovementId: number;
  entityType: string;
  entityId: number;
  linkType: string;
  amountLinked: string;
  status: "proposed" | "confirmed" | "rejected" | "unlinked";
  confidenceScore: number | null;
  matchedBy: string | null;
  matchedAt: string | null;
  rejectedAt: string | null;
  unlinkedAt: string | null;
  notes: string | null;
  createdAt: string;
};

type Conciliation = "sin_conciliar" | "conciliado" | "gasto_vinculado" | "ignorado" | "todos";
const CONCILIATION_FILTERS: readonly Conciliation[] = ["sin_conciliar", "conciliado", "gasto_vinculado", "ignorado", "todos"];
type StateKey = Exclude<Conciliation, "todos">;

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 70) return "text-success bg-success/10";
  if (score >= 40) return "text-warning bg-warning/10";
  return "text-muted-foreground bg-muted";
}

/** Estado único de un movimiento (el que muestra la insignia): ignorado > gasto vinculado > conciliado > sin conciliar. */
function stateOf(mv: Pick<BankMovement, "status" | "conciliationStatus" | "importe">): StateKey {
  if (mv.status === "ignorado") return "ignorado";
  if (mv.conciliationStatus === "conciliado") return parseFloat(mv.importe) < 0 ? "gasto_vinculado" : "conciliado";
  return "sin_conciliar";
}
const STATE_TONE: Record<StateKey, Tone> = { sin_conciliar: "warning", conciliado: "success", gasto_vinculado: "success", ignorado: "neutral" };
const IMPORT_TONE: Record<BankImport["status"], Tone> = { ok: "success", error: "danger", parcial: "warning" };
const MANUAL_TYPES = ["transferencia_interna", "comision_bancaria", "pago_impuesto", "ajuste_contable", "devolucion", "otro"] as const;
const LINK_ENTITIES = ["quote", "reservation", "invoice", "expense", "card_terminal_batch", "manual"];
const LINK_STATUSES = ["proposed", "confirmed", "rejected", "unlinked"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankMovementsManager() {
  const { t } = useI18n();
  const f = useFormat();
  const money = useMoney();
  const [tab, setTab] = useUrlParam("tab", ["movimientos", "importaciones"], "movimientos");

  // Filters
  const [conciliation, setConciliation] = useState<Conciliation>("sin_conciliar");
  const [filterImportId, setFilterImportId] = useState<number | undefined>(undefined);
  const [filterFechaFrom, setFilterFechaFrom] = useState("");
  const [filterFechaTo, setFilterFechaTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimeout = useMemo(() => ({ id: 0 as any }), []);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout(searchTimeout.id);
    searchTimeout.id = setTimeout(() => { setDebouncedSearch(v.trim()); setPage(0); }, 400);
  };

  // Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail sheet
  const [selectedMovement, setSelectedMovement] = useState<BankMovement | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<"pendiente" | "ignorado">("pendiente");
  const [savingDetail, setSavingDetail] = useState(false);

  // Conciliation panel state
  const [showMatches, setShowMatches] = useState(false);
  const [confirmingQuoteId, setConfirmingQuoteId] = useState<number | null>(null);
  const [rejectingQuoteId, setRejectingQuoteId] = useState<number | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);

  // Manual conciliation state
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualType, setManualType] = useState<string>("transferencia_interna");
  const [manualNotes, setManualNotes] = useState("");
  const [manualCounterparty, setManualCounterparty] = useState("");

  const fmtDate = (d: string | Date | null | undefined) => {
    if (!d) return "–";
    if (typeof d === "string" && !d.includes("T")) return f.date(new Date(`${d}T00:00:00`));
    return f.date(d);
  };
  const fmtAmount = (v: string | number | null | undefined) => money.eur(v, { nullAs: "–" });

  // ── Queries ────────────────────────────────────────────────────────────────

  const importsQ = trpc.bankMovements.listImports.useQuery();
  const syncQ = trpc.financeSync.setup.useQuery(undefined, { retry: false });

  // Mismo filtro para el listado y para los totales: el resumen es el del conjunto completo, no el de la página
  const baseFilter = {
    importId: filterImportId,
    fechaFrom: filterFechaFrom || undefined,
    fechaTo: filterFechaTo || undefined,
    search: debouncedSearch || undefined,
  };
  const movementsQ = trpc.bankMovements.listMovements.useQuery({ ...baseFilter, conciliation, page: page + 1, pageSize });
  const summaryQ = trpc.bankMovements.movementsSummary.useQuery({ ...baseFilter, conciliation });
  // Sin el estado de conciliación: reparte el filtro en sus cuatro estados (cifra «Sin conciliar» y contadores del selector)
  const statesQ = trpc.bankMovements.movementsSummary.useQuery({ ...baseFilter, conciliation: "todos" });

  const matchesQ = trpc.bankMovements.findMatches.useQuery(
    { bankMovementId: selectedMovement?.id ?? 0 },
    { enabled: !!selectedMovement && showMatches }
  );

  const linksQ = trpc.bankMovements.getLinks.useQuery(
    { bankMovementId: selectedMovement?.id ?? 0 },
    { enabled: !!selectedMovement }
  );

  const refetchLists = () => {
    void movementsQ.refetch();
    void summaryQ.refetch();
    void statesQ.refetch();
  };

  // ── Mutations ──────────────────────────────────────────────────────────────

  const uploadMut = trpc.bankMovements.uploadBankFile.useMutation({
    onSuccess: (r) => {
      toast.success(t("economyBank.toast.imported", { rows: r.importedRows, duplicates: r.duplicatesSkipped }));
      void importsQ.refetch();
      refetchLists();
      setUploading(false);
    },
    onError: (e) => {
      toastError(e);
      setUploading(false);
    },
  });

  const deleteImportMut = trpc.bankMovements.deleteImport.useMutation({
    onSuccess: () => {
      toast.success(t("economyBank.toast.importDeleted"));
      void importsQ.refetch();
      refetchLists();
    },
    onError: (e) => toastError(e),
  });

  const updateStatusMut = trpc.bankMovements.updateMovementStatus.useMutation({
    onSuccess: () => {
      toast.success(t("economyBank.toast.statusUpdated"));
      refetchLists();
      setSavingDetail(false);
      setSelectedMovement(null);
    },
    onError: (e) => {
      toastError(e);
      setSavingDetail(false);
    },
  });

  const confirmTransferMut = trpc.crm.quotes.confirmTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(t("economyBank.toast.confirmed", { invoice: data.invoiceNumber }));
      refetchLists();
      void linksQ.refetch();
      void matchesQ.refetch();
      setConfirmingQuoteId(null);
      setShowMatches(false);
      // Actualizar el movimiento seleccionado para reflejar conciliado
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "conciliado" });
      }
    },
    onError: (e) => {
      toastError(e);
      setConfirmingQuoteId(null);
    },
  });

  const rejectLinkMut = trpc.bankMovements.rejectLink.useMutation({
    onSuccess: () => {
      toast.success(t("economyBank.toast.rejected"));
      void matchesQ.refetch();
      void linksQ.refetch();
      setRejectingQuoteId(null);
    },
    onError: (e) => toastError(e),
  });

  const unlinkMut = trpc.bankMovements.unlinkMovement.useMutation({
    onSuccess: () => {
      toast.success(t("economyBank.toast.unlinked"));
      refetchLists();
      void linksQ.refetch();
      setUnlinkConfirm(false);
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "pendiente" });
      }
    },
    onError: (e) => toastError(e),
  });

  const manuallyConciliateMut = trpc.bankMovements.manuallyConciliate.useMutation({
    onSuccess: () => {
      toast.success(t("economyBank.toast.manual"));
      refetchLists();
      void linksQ.refetch();
      setShowManualForm(false);
      setManualNotes("");
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "conciliado" });
      }
    },
    onError: (e) => toastError(e),
  });

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["xls", "xlsx", "csv", "txt", "n43", "aeb", "q43"].includes(ext)) {
      toast.error(t("economyBank.toast.badFormat"));
      return;
    }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = btoa(
        new Uint8Array(ev.target!.result as ArrayBuffer).reduce(
          (data, byte) => data + String.fromCharCode(byte), ""
        )
      );
      uploadMut.mutate({ fileName: file.name, fileType: ext, fileBase64: base64 });
    };
    reader.readAsArrayBuffer(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadMut, t]);

  // ── Detail sheet ───────────────────────────────────────────────────────────

  const openDetail = (mv: BankMovement) => {
    setSelectedMovement(mv);
    setEditNotes(mv.notes ?? "");
    setEditStatus(mv.status);
    setShowMatches(false);
    setConfirmingQuoteId(null);
    setRejectingQuoteId(null);
    setUnlinkConfirm(false);
    setShowManualForm(false);
    setManualNotes("");
    setManualType("transferencia_interna");
    setManualCounterparty("");
  };

  const saveDetail = () => {
    if (!selectedMovement) return;
    setSavingDetail(true);
    updateStatusMut.mutate({ id: selectedMovement.id, status: editStatus, notes: editNotes });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const imports: BankImport[] = (importsQ.data as unknown as BankImport[]) ?? [];
  const movData = movementsQ.data;
  const movements: BankMovement[] = (movData?.data as unknown as BankMovement[]) ?? [];
  const totalMovs = movData?.total ?? 0;
  const summary = summaryQ.data;
  const states = statesQ.data;

  const confirmedLink = (linksQ.data as unknown as BankMovementLink[] | undefined)?.find(l => l.status === "confirmed");
  const matches: QuoteMatch[] = (matchesQ.data as any)?.matches ?? [];
  const isConciliated = selectedMovement?.conciliationStatus === "conciliado";
  const isPositive = selectedMovement ? parseFloat(selectedMovement.importe) > 0 : false;

  const stateLabel = (s: StateKey) => t(`economyBank.state.${s}`);
  const manualLabel = (k: string) => ((MANUAL_TYPES as readonly string[]).includes(k) ? t(`economyBank.manualType.${k}`) : k);
  const importTitle = (id: number) => imports.find((i) => i.id === id)?.fileName ?? `#${id}`;
  const dayChip = (v: string) => f.date(new Date(`${v}T00:00:00`), { day: "2-digit", month: "short", year: "numeric" });
  const clearMovFilters = () => {
    setSearch(""); setDebouncedSearch(""); setConciliation("todos"); setFilterImportId(undefined);
    setFilterFechaFrom(""); setFilterFechaTo(""); setPage(0);
  };
  const movChips: FilterChip[] = [
    ...(debouncedSearch ? [{ id: "q", label: t("economyBank.chip.search", { value: debouncedSearch }), onRemove: () => { setSearch(""); setDebouncedSearch(""); setPage(0); } }] : []),
    ...(filterImportId ? [{ id: "import", label: t("economyBank.chip.import", { value: importTitle(filterImportId) }), onRemove: () => { setFilterImportId(undefined); setPage(0); } }] : []),
    ...(filterFechaFrom ? [{ id: "from", label: t("economyBank.chip.from", { value: dayChip(filterFechaFrom) }), onRemove: () => { setFilterFechaFrom(""); setPage(0); } }] : []),
    ...(filterFechaTo ? [{ id: "to", label: t("economyBank.chip.to", { value: dayChip(filterFechaTo) }), onRemove: () => { setFilterFechaTo(""); setPage(0); } }] : []),
  ];
  const filtersActive = movChips.length > 0 || conciliation !== "todos";
  const moreActive = filterImportId ? 1 : 0;

  const stateCount = (k: Conciliation): number | undefined => {
    if (!states) return undefined;
    if (k === "todos") return states.count;
    if (k === "sin_conciliar") return states.sinConciliar.count;
    if (k === "conciliado") return states.conciliados.count;
    if (k === "gasto_vinculado") return states.gastoVinculado.count;
    return states.ignorados.count;
  };

  const dash = "—";
  const stripItems: SummaryStripItem[] = [
    {
      key: "pending",
      label: t("economyBank.summary.pending"),
      value: states ? String(states.sinConciliar.count) : dash,
      detail: states ? t("economyBank.summary.pendingDetail", { amount: money.eur(states.sinConciliar.amountAbs) }) : undefined,
      primary: true,
      tone: states && states.sinConciliar.count > 0 ? "warning" : "success",
      onClick: () => { setConciliation("sin_conciliar"); setPage(0); },
      active: conciliation === "sin_conciliar",
    },
    { key: "in", label: t("economyBank.summary.income"), value: summary ? money.eur(summary.ingresado) : dash, tone: "success" },
    { key: "out", label: t("economyBank.summary.outflow"), value: summary ? money.eur(summary.cargado) : dash, tone: "danger" },
    {
      key: "total",
      label: t("economyBank.summary.total"),
      value: summary ? String(summary.count) : dash,
      tone: "info",
    },
  ];

  const stateBadge = (mv: BankMovement) => {
    const s = stateOf(mv);
    return <StatusBadge tone={STATE_TONE[s]}>{stateLabel(s)}</StatusBadge>;
  };
  const amountOf = (mv: BankMovement) => (
    <span className={cn("whitespace-nowrap font-semibold tabular-nums", parseFloat(mv.importe) >= 0 ? "text-success" : "text-danger")}>{fmtAmount(mv.importe)}</span>
  );

  const movColumns: EconomyColumn<BankMovement>[] = [
    {
      key: "fecha",
      header: t("economyBank.col.date"),
      mobile: "title",
      cell: (mv) => <span className="font-mono text-xs text-foreground">{fmtDate(mv.fecha)}</span>,
    },
    { key: "valor", header: t("economyBank.col.valueDate"), priority: "xl", cell: (mv) => <span className="font-mono text-xs text-muted-foreground">{fmtDate(mv.fechaValor)}</span> },
    {
      key: "mov",
      header: t("economyBank.col.movement"),
      mobile: "hidden",
      className: "max-w-[22rem]",
      cell: (mv) => (
        <span className="line-clamp-2 break-words text-foreground" title={mv.movimiento ?? undefined}>{mv.movimiento || "–"}</span>
      ),
    },
    {
      key: "mas",
      header: t("economyBank.col.moreData"),
      priority: "lg",
      mobile: "hidden",
      className: "max-w-[16rem]",
      cell: (mv) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={mv.masDatos ?? undefined}>{mv.masDatos || "–"}</span>,
    },
    { key: "importe", header: t("economyBank.col.amount"), align: "right", num: true, mobile: "amount", cell: amountOf },
    { key: "saldo", header: t("economyBank.col.balance"), align: "right", num: true, priority: "lg", cell: (mv) => <span className="text-xs text-muted-foreground">{fmtAmount(mv.saldo)}</span> },
    { key: "state", header: t("economyBank.col.state"), cell: stateBadge },
  ];

  const importColumns: EconomyColumn<BankImport>[] = [
    {
      key: "file",
      header: t("economyBank.imports.file"),
      mobile: "title",
      cell: (imp) => (
        <>
          <div className="flex items-center gap-2 font-medium text-foreground">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            <span className="break-all">{imp.fileName}</span>
          </div>
          {imp.errorMessage && (
            <div className="mt-1 flex items-center gap-1 text-xs font-normal text-danger">
              <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" /> {imp.errorMessage}
            </div>
          )}
        </>
      ),
    },
    { key: "type", header: t("economyBank.imports.type"), priority: "md", cell: (imp) => <span className="font-mono text-xs uppercase text-muted-foreground">{imp.fileType}</span> },
    { key: "rows", header: t("economyBank.imports.imported"), align: "right", num: true, cell: (imp) => <span className="font-semibold text-info">{imp.importedRows}</span> },
    { key: "dups", header: t("economyBank.imports.duplicates"), align: "right", num: true, priority: "md", cell: (imp) => <span className="text-muted-foreground">{imp.duplicatesSkipped}</span> },
    {
      key: "status",
      header: t("economyBank.col.state"),
      cell: (imp) => <StatusBadge tone={IMPORT_TONE[imp.status]}>{t(`economyBank.imports.status.${imp.status}`)}</StatusBadge>,
    },
    { key: "date", header: t("economyBank.col.date"), priority: "md", cell: (imp) => <span className="text-xs text-muted-foreground">{f.dateTime(imp.createdAt)}</span> },
  ];

  const syncChip = syncQ.data && !syncQ.data.ready ? (
    <Link
      href={FINANCE_SYNC_SETUP_PATH}
      title={t("economyBank.sync.hint", { next: syncQ.data.missing[0] ?? "" })}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 text-xs font-medium text-foreground transition hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
    >
      <Rocket className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
      <span className="whitespace-nowrap">{t("economyBank.sync.chip", { done: syncQ.data.completed, total: syncQ.data.total })}</span>
    </Link>
  ) : null;

  const stateScroll = useScrollFade<HTMLDivElement>(`${conciliation}-${states?.count ?? 0}`);
  const tabButtons = (["movimientos", "importaciones"] as const).map((k) => ({ key: k, label: k === "movimientos" ? t("economyBank.tab.movements") : t("economyBank.tab.imports", { count: imports.length }) }));

  const cardLabel = (mv: BankMovement) => mv.movimiento || fmtDate(mv.fecha);

  return (
    <AdminLayout>
      <EconomyShell
        screen="bank"
        description={t("economyBank.description")}
        headerExtra={syncChip}
        action={
          <>
            <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-2">
              {uploading ? (
                <><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> {t("economyBank.importing")}</>
              ) : (
                <><Upload className="h-4 w-4" aria-hidden="true" /> {t("economyBank.import")}</>
              )}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.txt,.n43,.aeb,.q43" className="hidden" onChange={handleFileChange} aria-label={t("economyBank.import")} />
          </>
        }
      >
        <div className="space-y-3">
          <SummaryStrip items={stripItems} label={t("economyBank.summary.label")} />

          {/* Pestañas: Movimientos · Importaciones */}
          <div className="flex gap-1 border-b border-border" role="tablist" aria-label={t("economyBank.tab.label")}>
            {tabButtons.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={tab === x.key}
                onClick={() => setTab(x.key)}
                className={cn("-mb-px min-h-10 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors", tab === x.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {x.label}
              </button>
            ))}
          </div>

          {/* ── TAB: Movimientos ── */}
          {tab === "movimientos" && (
            <div className="space-y-3">
              {/* Estado de conciliación: el filtro principal */}
              <div ref={stateScroll.ref} onScroll={stateScroll.onScroll} style={stateScroll.style} className={SCROLL_NAV}>
                <div role="radiogroup" aria-label={t("economyBank.filter.stateLabel")} className="inline-flex min-w-max gap-1 rounded-xl border border-border bg-card/80 p-1 shadow-sm">
                  {CONCILIATION_FILTERS.map((k) => {
                    const on = conciliation === k;
                    const n = stateCount(k);
                    return (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-active={on}
                        onClick={() => { setConciliation(k); setPage(0); }}
                        className={cn(TAB_BASE, "h-10 gap-2 sm:h-9", on ? TAB_ON : TAB_OFF)}
                      >
                        {t(`economyBank.filter.${k}`)}
                        {n != null && <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{n}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <ToolbarRow
                search={{ value: search, onChange: handleSearch, placeholder: t("economyBank.toolbar.search") }}
                filters={
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                      {t("economyBank.toolbar.from")}
                      <Input type="date" value={filterFechaFrom} max={filterFechaTo || undefined} onChange={(e) => { setFilterFechaFrom(e.target.value); setPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground max-sm:justify-between">
                      {t("economyBank.toolbar.to")}
                      <Input type="date" value={filterFechaTo} min={filterFechaFrom || undefined} onChange={(e) => { setFilterFechaTo(e.target.value); setPage(0); }} className="h-9 w-40 bg-card max-sm:h-10 max-sm:w-44" />
                    </label>
                    <MoreFilters label={t("economyBank.toolbar.more")} count={moreActive}>
                      <FilterField label={t("economyBank.toolbar.import")}>
                        <Select
                          value={filterImportId ? String(filterImportId) : "todos"}
                          onValueChange={(v) => { setFilterImportId(v === "todos" ? undefined : Number(v)); setPage(0); }}
                        >
                          <SelectTrigger className="w-full"><SelectValue placeholder={t("economyBank.toolbar.allImports")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todos">{t("economyBank.toolbar.allImports")}</SelectItem>
                            {imports.map((imp) => (
                              <SelectItem key={imp.id} value={String(imp.id)}>{imp.fileName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FilterField>
                    </MoreFilters>
                  </>
                }
                chips={movChips}
                onClear={clearMovFilters}
                summary={t("economyBank.toolbar.resultCount", { count: totalMovs })}
              />

              {!movementsQ.isLoading && !movementsQ.error && movements.length === 0 ? (
                <CompactEmpty
                  icon={<SearchX />}
                  title={filtersActive ? t("economyBank.empty.title") : t("economyBank.empty.noneTitle")}
                  description={filtersActive ? t("economyBank.empty.description") : t("economyBank.empty.noneDescription")}
                  action={filtersActive ? <Button variant="outline" size="sm" className="max-sm:h-10" onClick={clearMovFilters}>{t("economyBank.empty.clear")}</Button> : undefined}
                />
              ) : (
                <EconomyTable
                  rows={movements}
                  columns={movColumns}
                  rowKey={(mv) => mv.id}
                  caption={t("economyBank.caption")}
                  loading={movementsQ.isLoading}
                  error={movementsQ.error}
                  errorTitle={t("economyBank.loadError")}
                  onRetry={() => void movementsQ.refetch()}
                  emptyTitle={t("economyBank.empty.noneTitle")}
                  rowClassName={(mv) => (mv.status === "ignorado" ? "opacity-60" : undefined)}
                  onRowClick={openDetail}
                  actions={(mv) => (
                    <RowActions label={cardLabel(mv)} primary={{ label: t("economyBank.action.review"), icon: <Eye className="h-4 w-4" />, onSelect: () => openDetail(mv) }} />
                  )}
                  mobileCard={(mv) => (
                    <button type="button" onClick={() => openDetail(mv)} className="block w-full min-w-0 space-y-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex items-start justify-between gap-3">
                        <span className="line-clamp-2 min-w-0 break-words text-sm font-medium text-foreground">{mv.movimiento || "–"}</span>
                        <span className="shrink-0 text-sm">{amountOf(mv)}</span>
                      </span>
                      {mv.masDatos && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{mv.masDatos}</span>}
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{fmtDate(mv.fecha)}</span>
                        {stateBadge(mv)}
                      </span>
                    </button>
                  )}
                  footer={<EconomyPager page={page} pageSize={pageSize} total={totalMovs} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(0); }} />}
                />
              )}
            </div>
          )}

          {/* ── TAB: Importaciones ── */}
          {tab === "importaciones" && (
            <EconomyTable
              rows={imports}
              columns={importColumns}
              rowKey={(imp) => imp.id}
              caption={t("economyBank.imports.caption")}
              loading={importsQ.isLoading}
              error={importsQ.error}
              onRetry={() => void importsQ.refetch()}
              emptyTitle={t("economyBank.imports.emptyTitle")}
              emptyDescription={t("economyBank.imports.emptyDescription")}
              actions={(imp) => (
                <RowActions
                  label={imp.fileName}
                  menu={[{
                    label: t("economyBank.imports.delete"),
                    icon: <Trash2 />,
                    destructive: true,
                    onSelect: async () => {
                      if (!(await confirmAction({ description: t("economyBank.imports.deleteConfirm", { name: imp.fileName }), destructive: true }))) return;
                      deleteImportMut.mutate({ id: imp.id });
                    },
                  }]}
                />
              )}
            />
          )}
        </div>

        {/* ── Detalle del movimiento: hoja a la derecha (pantalla completa en móvil) ── */}
        <Sheet open={!!selectedMovement} onOpenChange={(o) => !o && setSelectedMovement(null)}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
            {selectedMovement && (() => {
              const isManual = confirmedLink?.entityType === "manual";
              const st = stateOf(selectedMovement);
              return (
                <>
                  <SheetHeader className="space-y-2 border-b border-border p-4 pr-12">
                    <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                      {t("economyBank.detail.title")}
                      {isManual ? <StatusBadge tone="brand">{t("economyBank.state.manual")}</StatusBadge> : <StatusBadge tone={STATE_TONE[st]}>{stateLabel(st)}</StatusBadge>}
                    </SheetTitle>
                    <SheetDescription className="sr-only">{t("economyBank.detail.description")}</SheetDescription>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="line-clamp-2 min-w-0 break-words text-sm text-foreground">{selectedMovement.movimiento || "–"}</span>
                      <span className={cn("shrink-0 text-lg font-bold tabular-nums", parseFloat(selectedMovement.importe) >= 0 ? "text-success" : "text-danger")}>{fmtAmount(selectedMovement.importe)}</span>
                    </div>
                  </SheetHeader>

                  <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-4">
                    {/* ── Conciliación (solo ingresos): lo primero ── */}
                    {isPositive && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Link2 className="h-4 w-4 text-info" aria-hidden="true" />
                            {t("economyBank.conc.title")}
                          </h3>
                          {isConciliated ? (
                            <Button variant="outline" size="sm" className="h-10 border-danger/40 text-xs text-danger hover:bg-danger/10 sm:h-8" onClick={() => setUnlinkConfirm(true)}>
                              <Link2Off className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("economyBank.conc.unlink")}
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="h-10 border-info/40 text-xs text-info hover:bg-info/10 sm:h-8" onClick={() => setShowMatches(!showMatches)}>
                              <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                              {showMatches ? t("economyBank.conc.hide") : t("economyBank.conc.find")}
                            </Button>
                          )}
                        </div>

                        {/* Vínculo confirmado */}
                        {isConciliated && confirmedLink && (
                          <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                            <div className="mb-2 flex items-center gap-2 font-medium text-success">
                              <CheckCircle className="h-4 w-4" aria-hidden="true" /> {t("economyBank.conc.reconciledWith")}
                            </div>
                            <div className="grid grid-cols-1 gap-1 text-xs text-success sm:grid-cols-2">
                              <span>{t("economyBank.conc.entity")}: {(LINK_ENTITIES.includes(confirmedLink.entityType) ? t(`economyBank.entity.${confirmedLink.entityType}`) : confirmedLink.entityType)} #{confirmedLink.entityId}</span>
                              <span>{t("economyBank.conc.amount")}: {fmtAmount(confirmedLink.amountLinked)}</span>
                              <span>{t("economyBank.conc.by")}: {confirmedLink.matchedBy ?? "–"}</span>
                              <span>{t("economyBank.conc.date")}: {confirmedLink.matchedAt ? fmtDate(confirmedLink.matchedAt) : "–"}</span>
                            </div>
                          </div>
                        )}

                        {/* Panel de propuestas */}
                        {!isConciliated && showMatches && (
                          <div className="space-y-2">
                            {matchesQ.isLoading ? (
                              <div className="py-4 text-center text-sm text-muted-foreground">
                                <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />{t("economyBank.conc.searching")}
                              </div>
                            ) : matches.length === 0 ? (
                              <div className="rounded-lg border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
                                <Info className="mr-1 inline h-4 w-4" aria-hidden="true" />
                                {t("economyBank.conc.none")}
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">{t("economyBank.conc.found", { count: matches.length })}</p>
                                {matches.map((m) => (
                                  <div
                                    key={m.quoteId}
                                    className={`space-y-2 rounded-lg border p-3 text-sm ${m.isRejected ? "border-border bg-muted opacity-50" : "border-info/40 bg-info/10"}`}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 space-y-0.5">
                                        <div className="break-words font-semibold text-foreground">{m.quoteNumber} — {m.title}</div>
                                        <div className="break-words text-xs text-muted-foreground">
                                          {m.clientName && <span>{m.clientName} · </span>}
                                          {m.clientEmail && <span>{m.clientEmail} · </span>}
                                          {t("economyBank.conc.total")}: <span className="font-medium text-foreground">{fmtAmount(m.total)}</span>
                                        </div>
                                        {m.sentAt && (
                                          <div className="text-xs text-muted-foreground">{t("economyBank.conc.sent")}: {fmtDate(m.sentAt)}</div>
                                        )}
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-1">
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreColor(m.confidenceScore)}`}>
                                          {t("economyBank.conc.match", { score: m.confidenceScore })}
                                        </span>
                                        {m.isRejected && <span className="text-xs text-muted-foreground">{t("economyBank.conc.rejectedTag")}</span>}
                                      </div>
                                    </div>

                                    {confirmingQuoteId === m.quoteId ? (
                                      <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3">
                                        <p className="text-xs font-medium text-warning">{t("economyBank.conc.confirmQuestion")}</p>
                                        <p className="text-xs text-warning">
                                          {t("economyBank.conc.confirmBody", { date: fmtDate(selectedMovement.fecha), amount: fmtAmount(selectedMovement.importe), quote: m.quoteNumber })}
                                        </p>
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            className="h-10 text-xs sm:h-8"
                                            disabled={confirmTransferMut.isPending}
                                            onClick={() => {
                                              confirmTransferMut.mutate({
                                                quoteId: m.quoteId,
                                                bankMovementId: selectedMovement.id,
                                              });
                                            }}
                                          >
                                            {confirmTransferMut.isPending
                                              ? <><RefreshCw className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />{t("economyBank.conc.processing")}</>
                                              : <><CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" />{t("economyBank.conc.yesConfirm")}</>
                                            }
                                          </Button>
                                          <Button size="sm" variant="outline" className="h-10 text-xs sm:h-8" onClick={() => setConfirmingQuoteId(null)}>
                                            {t("economyBank.cancel")}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : rejectingQuoteId === m.quoteId ? (
                                      <div className="space-y-2 rounded-md border border-border bg-muted p-3">
                                        <p className="text-xs text-foreground">{t("economyBank.conc.rejectQuestion")}</p>
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-10 border-danger/40 text-xs text-danger hover:bg-danger/10 sm:h-8"
                                            disabled={rejectLinkMut.isPending}
                                            onClick={() => rejectLinkMut.mutate({ bankMovementId: selectedMovement.id, quoteId: m.quoteId })}
                                          >
                                            {rejectLinkMut.isPending ? "…" : t("economyBank.conc.yesReject")}
                                          </Button>
                                          <Button size="sm" variant="outline" className="h-10 text-xs sm:h-8" onClick={() => setRejectingQuoteId(null)}>
                                            {t("economyBank.cancel")}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap gap-2">
                                        <Button size="sm" className="h-10 text-xs sm:h-8" onClick={() => setConfirmingQuoteId(m.quoteId)}>
                                          <CheckCircle className="mr-1 h-3 w-3" aria-hidden="true" /> {t("economyBank.conc.accept")}
                                        </Button>
                                        <Button size="sm" variant="outline" className="h-10 text-xs text-muted-foreground sm:h-8" onClick={() => setRejectingQuoteId(m.quoteId)}>
                                          <ThumbsDown className="mr-1 h-3 w-3" aria-hidden="true" /> {t("economyBank.conc.reject")}
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Historial de vínculos */}
                        {linksQ.data && (linksQ.data as unknown as BankMovementLink[]).length > 0 && (
                          <details className="text-xs">
                            <summary className="min-h-8 cursor-pointer py-1.5 text-muted-foreground hover:text-foreground">{t("economyBank.conc.history", { count: (linksQ.data as unknown as BankMovementLink[]).length })}</summary>
                            <div className="mt-2 space-y-1 border-l-2 border-border pl-2">
                              {(linksQ.data as unknown as BankMovementLink[]).map(l => (
                                <div key={l.id} className="text-muted-foreground">
                                  <span className={`mr-1 inline-block rounded px-1.5 py-0.5 text-xs ${
                                    l.status === "confirmed" ? "bg-success/10 text-success" :
                                    l.status === "rejected" ? "bg-danger/10 text-danger" :
                                    l.status === "unlinked" ? "bg-muted text-muted-foreground" :
                                    "bg-info/10 text-info"
                                  }`}>{LINK_STATUSES.includes(l.status) ? t(`economyBank.linkStatus.${l.status}`) : l.status}</span>
                                  {LINK_ENTITIES.includes(l.entityType) ? t(`economyBank.entity.${l.entityType}`) : l.entityType} #{l.entityId} · {fmtAmount(l.amountLinked)}
                                  {l.matchedBy && ` · ${l.matchedBy}`}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}

                    {/* ── Conciliación manual ── */}
                    {!isConciliated && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <CheckCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                            {t("economyBank.manual.title")}
                          </h3>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-10 border-primary/40 text-xs text-primary hover:bg-primary/10 sm:h-8"
                            onClick={() => setShowManualForm(!showManualForm)}
                          >
                            {showManualForm ? t("economyBank.cancel") : t("economyBank.manual.open")}
                          </Button>
                        </div>
                        {showManualForm && (
                          <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/10 p-4">
                            <p className="text-xs text-primary">{t("economyBank.manual.help")}</p>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">{t("economyBank.manual.type")} *</label>
                              <Select value={manualType} onValueChange={setManualType}>
                                <SelectTrigger className="w-full text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {MANUAL_TYPES.map((k) => <SelectItem key={k} value={k}>{manualLabel(k)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">{t("economyBank.manual.counterparty")}</label>
                              <Input
                                className="text-sm"
                                value={manualCounterparty}
                                onChange={(e) => setManualCounterparty(e.target.value)}
                                placeholder={t("economyBank.manual.counterpartyPlaceholder")}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-muted-foreground">{t("economyBank.manual.justification")} *</label>
                              <textarea
                                className="w-full resize-none rounded-md border border-primary/40 bg-card p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                                rows={2}
                                value={manualNotes}
                                onChange={(e) => setManualNotes(e.target.value)}
                                placeholder={t("economyBank.manual.justificationPlaceholder")}
                              />
                            </div>
                            <Button
                              size="sm"
                              className="h-10 w-full text-xs sm:h-9"
                              disabled={!manualNotes.trim() || manuallyConciliateMut.isPending}
                              onClick={() => {
                                if (selectedMovement) {
                                  manuallyConciliateMut.mutate({
                                    bankMovementId: selectedMovement.id,
                                    manualType: manualType as any,
                                    counterparty: manualCounterparty.trim() || undefined,
                                    notes: manualNotes.trim(),
                                  });
                                }
                              }}
                            >
                              {manuallyConciliateMut.isPending ? t("economyBank.manual.saving") : t("economyBank.manual.confirm")}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Info cuando está conciliado manualmente */}
                    {isConciliated && confirmedLink?.entityType === "manual" && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <CheckCircle className="h-4 w-4 text-primary" aria-hidden="true" />
                            {t("economyBank.manual.title")}
                          </h3>
                          <Button variant="outline" size="sm" className="h-10 border-danger/40 text-xs text-danger hover:bg-danger/10 sm:h-8" onClick={() => setUnlinkConfirm(true)}>
                            <Link2Off className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {t("economyBank.conc.unlink")}
                          </Button>
                        </div>
                        <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                          <div className="mb-1 flex items-center gap-2 font-medium text-primary">
                            <CheckCircle className="h-4 w-4" aria-hidden="true" /> {t("economyBank.manual.done")}
                          </div>
                          <p className="break-words text-xs text-primary">{confirmedLink.notes ?? "—"}</p>
                          <div className="mt-1 text-xs text-primary">
                            {t("economyBank.manual.by", { who: confirmedLink.matchedBy ?? "–", date: confirmedLink.matchedAt ? fmtDate(confirmedLink.matchedAt) : "–" })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Datos del movimiento */}
                    <FormSection title={t("economyBank.detail.data")}>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="mb-1 text-xs text-muted-foreground">{t("economyBank.col.date")}</div>
                          <div className="font-medium">{fmtDate(selectedMovement.fecha)}</div>
                        </div>
                        <div>
                          <div className="mb-1 text-xs text-muted-foreground">{t("economyBank.col.valueDate")}</div>
                          <div className="font-medium">{fmtDate(selectedMovement.fechaValor)}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="mb-1 text-xs text-muted-foreground">{t("economyBank.col.movement")}</div>
                          <div className="break-words font-medium">{selectedMovement.movimiento || "–"}</div>
                        </div>
                        {selectedMovement.masDatos && (
                          <div className="col-span-2">
                            <div className="mb-1 text-xs text-muted-foreground">{t("economyBank.col.moreData")}</div>
                            <div className="break-words text-xs text-foreground">{selectedMovement.masDatos}</div>
                          </div>
                        )}
                        {selectedMovement.saldo && (
                          <div>
                            <div className="mb-1 text-xs text-muted-foreground">{t("economyBank.col.balance")}</div>
                            <div className="font-medium tabular-nums">{fmtAmount(selectedMovement.saldo)}</div>
                          </div>
                        )}
                      </div>
                    </FormSection>

                    {/* Estado y notas: lo último */}
                    <FormSection title={t("economyBank.detail.stateNotes")}>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">{t("economyBank.col.state")}</label>
                        <Select value={editStatus} onValueChange={(v) => setEditStatus(v as "pendiente" | "ignorado")}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pendiente">
                              <span className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-warning" aria-hidden="true" /> {t("economyBank.status.pendiente")}</span>
                            </SelectItem>
                            <SelectItem value="ignorado">
                              <span className="flex items-center gap-2"><MinusCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {t("economyBank.status.ignorado")}</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">{t("economyBank.detail.notes")}</label>
                        <textarea
                          className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-info/40"
                          rows={3}
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder={t("economyBank.detail.notesPlaceholder")}
                        />
                      </div>
                    </FormSection>

                    <FormFooter>
                      <Button variant="outline" onClick={() => setSelectedMovement(null)}>{t("economyBank.cancel")}</Button>
                      <Button onClick={saveDetail} disabled={savingDetail}>
                        {savingDetail ? t("economyBank.saving") : t("economyBank.save")}
                      </Button>
                    </FormFooter>
                  </div>
                </>
              );
            })()}
          </SheetContent>
        </Sheet>

        {/* ── Confirmar desvinculación ── */}
        <Dialog open={unlinkConfirm} onOpenChange={setUnlinkConfirm}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>{t("economyBank.unlink.title")}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("economyBank.unlink.body")}{" "}
              <strong>{t("economyBank.unlink.note")}</strong>
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setUnlinkConfirm(false)}>{t("economyBank.cancel")}</Button>
              <Button
                className="bg-danger text-primary-foreground hover:bg-danger/90"
                disabled={unlinkMut.isPending}
                onClick={() => {
                  if (selectedMovement) unlinkMut.mutate({ bankMovementId: selectedMovement.id });
                }}
              >
                {unlinkMut.isPending ? t("economyBank.unlink.working") : t("economyBank.conc.unlink")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </EconomyShell>
    </AdminLayout>
  );
}
