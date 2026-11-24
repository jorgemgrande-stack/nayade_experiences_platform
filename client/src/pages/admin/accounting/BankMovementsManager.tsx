import { useState, useRef, useCallback } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader, StatusBadge } from "@/components/admin/PanelUi";
import { EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormSection, RowActions, type EconomyColumn, type FilterChip } from "./shared/EconomyUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import FinanceSyncSetupBanner from "@/components/finance/FinanceSyncSetupBanner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, Trash2, Eye, TrendingUp, TrendingDown,
  FileSpreadsheet, RefreshCw, ChevronLeft, ChevronRight,
  CheckCircle, MinusCircle, AlertCircle, Link2, Link2Off,
  Sparkles, ThumbsDown, Info,
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtAmount(v: string | number | null | undefined): string {
  if (v == null) return "–";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "–";
  return n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "–";
  if (d instanceof Date) return d.toLocaleDateString("es-ES");
  if (d.includes("T")) return new Date(d).toLocaleDateString("es-ES");
  return d;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-success bg-success/10";
  if (score >= 40) return "text-warning bg-warning/10";
  return "text-muted-foreground bg-muted";
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-warning/10 text-warning" },
  ignorado:  { label: "Ignorado",  cls: "bg-muted text-muted-foreground" },
};

const CONCILIATION_BADGE: Record<string, { label: string; cls: string; icon?: string }> = {
  pendiente:   { label: "Sin conciliar", cls: "bg-warning/10 text-warning" },
  conciliado:  { label: "Conciliado",    cls: "bg-success/10 text-success" },
};
const EXPENSE_CONCILIATION_BADGE = { label: "Gasto vinculado", cls: "bg-success/10 text-success" };
const MANUAL_CONCILIATION_BADGE  = { label: "Justificado",     cls: "bg-primary/10 text-primary" };

const IMPORT_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ok:     { label: "OK",      cls: "bg-success/10 text-success" },
  error:  { label: "Error",   cls: "bg-danger/10 text-danger" },
  parcial:{ label: "Parcial", cls: "bg-warning/10 text-warning" },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function BankMovementsManager() {
  const [tab, setTab] = useState<"movimientos" | "importaciones">("movimientos");

  // Filters
  const [filterStatus, setFilterStatus] = useState<"todos" | "pendiente" | "ignorado">("todos");
  const [filterImportId, setFilterImportId] = useState<number | undefined>(undefined);
  const [filterFechaFrom, setFilterFechaFrom] = useState("");
  const [filterFechaTo, setFilterFechaTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Upload state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detail modal
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

  // ── Queries ────────────────────────────────────────────────────────────────

  const importsQ = trpc.bankMovements.listImports.useQuery();

  const movementsQ = trpc.bankMovements.listMovements.useQuery({
    importId: filterImportId,
    status: filterStatus,
    fechaFrom: filterFechaFrom || undefined,
    fechaTo: filterFechaTo || undefined,
    search: search || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const matchesQ = trpc.bankMovements.findMatches.useQuery(
    { bankMovementId: selectedMovement?.id ?? 0 },
    { enabled: !!selectedMovement && showMatches }
  );

  const linksQ = trpc.bankMovements.getLinks.useQuery(
    { bankMovementId: selectedMovement?.id ?? 0 },
    { enabled: !!selectedMovement }
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const uploadMut = trpc.bankMovements.uploadBankFile.useMutation({
    onSuccess: (r) => {
      toast.success(`Importados ${r.importedRows} movimientos (${r.duplicatesSkipped} duplicados omitidos)`);
      importsQ.refetch();
      movementsQ.refetch();
      setUploading(false);
    },
    onError: (e) => {
      toast.error("Error al importar: " + e.message);
      setUploading(false);
    },
  });

  const deleteImportMut = trpc.bankMovements.deleteImport.useMutation({
    onSuccess: () => {
      toast.success("Importación eliminada");
      importsQ.refetch();
      movementsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatusMut = trpc.bankMovements.updateMovementStatus.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      movementsQ.refetch();
      setSavingDetail(false);
      setSelectedMovement(null);
    },
    onError: (e) => {
      toast.error(e.message);
      setSavingDetail(false);
    },
  });

  const confirmTransferMut = trpc.crm.quotes.confirmTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(`Conciliación confirmada · Factura ${data.invoiceNumber} generada`);
      movementsQ.refetch();
      linksQ.refetch();
      matchesQ.refetch();
      setConfirmingQuoteId(null);
      setShowMatches(false);
      // Actualizar el movimiento seleccionado para reflejar conciliado
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "conciliado" });
      }
    },
    onError: (e) => {
      toast.error("Error al confirmar: " + e.message);
      setConfirmingQuoteId(null);
    },
  });

  const rejectLinkMut = trpc.bankMovements.rejectLink.useMutation({
    onSuccess: () => {
      toast.success("Propuesta rechazada");
      matchesQ.refetch();
      linksQ.refetch();
      setRejectingQuoteId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const unlinkMut = trpc.bankMovements.unlinkMovement.useMutation({
    onSuccess: () => {
      toast.success("Conciliación desvinculada. El movimiento vuelve a estar pendiente.");
      movementsQ.refetch();
      linksQ.refetch();
      setUnlinkConfirm(false);
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "pendiente" });
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const manuallyConciliateMut = trpc.bankMovements.manuallyConciliate.useMutation({
    onSuccess: () => {
      toast.success("Movimiento conciliado manualmente");
      movementsQ.refetch();
      linksQ.refetch();
      setShowManualForm(false);
      setManualNotes("");
      if (selectedMovement) {
        setSelectedMovement({ ...selectedMovement, conciliationStatus: "conciliado" });
      }
    },
    onError: (e) => toast.error(e.message),
  });

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["xls", "xlsx", "csv", "txt", "n43", "aeb", "q43"].includes(ext)) {
      toast.error("Formato no soportado. Usa el Excel o CSV del extracto (.xls, .xlsx, .csv) o el fichero Norma 43 de tu banco (.txt, .n43, .aeb, .q43)");
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
  }, [uploadMut]);

  // ── Detail modal ───────────────────────────────────────────────────────────

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
  const totalPages = Math.max(1, Math.ceil(totalMovs / PAGE_SIZE));
  const totalIngresado = movData?.totalIngresado ?? 0;
  const totalCargado = movData?.totalCargado ?? 0;

  const confirmedLink = (linksQ.data as unknown as BankMovementLink[] | undefined)?.find(l => l.status === "confirmed");
  const matches: QuoteMatch[] = (matchesQ.data as any)?.matches ?? [];
  const isConciliated = selectedMovement?.conciliationStatus === "conciliado";
  const isPositive = selectedMovement ? parseFloat(selectedMovement.importe) > 0 : false;

  const sinConciliar = movements.filter((m) => m.status === "pendiente" && m.conciliationStatus !== "conciliado").length;
  const dateChip = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("es-ES");
  const clearMovFilters = () => {
    setSearch(""); setFilterStatus("todos"); setFilterImportId(undefined);
    setFilterFechaFrom(""); setFilterFechaTo(""); setPage(1);
  };
  const movChips: FilterChip[] = [
    ...(search ? [{ id: "q", label: `Búsqueda: ${search}`, onRemove: () => { setSearch(""); setPage(1); } }] : []),
    ...(filterStatus !== "todos" ? [{ id: "status", label: `Estado: ${STATUS_BADGE[filterStatus].label}`, onRemove: () => { setFilterStatus("todos"); setPage(1); } }] : []),
    ...(filterImportId ? [{ id: "import", label: `Importación: ${imports.find((i) => i.id === filterImportId)?.fileName ?? `#${filterImportId}`}`, onRemove: () => { setFilterImportId(undefined); setPage(1); } }] : []),
    ...(filterFechaFrom ? [{ id: "from", label: `Desde ${dateChip(filterFechaFrom)}`, onRemove: () => { setFilterFechaFrom(""); setPage(1); } }] : []),
    ...(filterFechaTo ? [{ id: "to", label: `Hasta ${dateChip(filterFechaTo)}`, onRemove: () => { setFilterFechaTo(""); setPage(1); } }] : []),
  ];

  const movColumns: EconomyColumn<BankMovement>[] = [
    {
      key: "fecha",
      header: "Fecha",
      mobile: "title",
      cell: (mv) => (
        <>
          <span className="font-mono text-xs text-foreground">{fmtDate(mv.fecha)}</span>
          <span className="mt-0.5 block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-foreground @2xl:hidden">{mv.movimiento || "–"}</span>
        </>
      ),
    },
    { key: "valor", header: "F. valor", priority: "xl", cell: (mv) => <span className="font-mono text-xs text-muted-foreground">{fmtDate(mv.fechaValor)}</span> },
    {
      key: "mov",
      header: "Movimiento",
      mobile: "hidden",
      className: "max-w-[14rem]",
      cell: (mv) => (
        <>
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground" title={mv.movimiento ?? undefined}>{mv.movimiento || "–"}</span>
          {mv.masDatos && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground @5xl:hidden">{mv.masDatos}</span>}
        </>
      ),
    },
    {
      key: "mas",
      header: "Más datos",
      priority: "lg",
      mobile: "hidden",
      className: "max-w-[14rem]",
      cell: (mv) => <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground" title={mv.masDatos ?? undefined}>{mv.masDatos || "–"}</span>,
    },
    {
      key: "importe",
      header: "Importe",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (mv) => <span className={`font-semibold ${parseFloat(mv.importe) >= 0 ? "text-success" : "text-danger"}`}>{fmtAmount(mv.importe)}</span>,
    },
    { key: "saldo", header: "Saldo", align: "right", num: true, priority: "lg", cell: (mv) => <span className="text-xs text-muted-foreground">{fmtAmount(mv.saldo)}</span> },
    {
      key: "status",
      header: "Estado",
      priority: "md",
      cell: (mv) => <StatusBadge tone={mv.status === "ignorado" ? "neutral" : "warning"}>{STATUS_BADGE[mv.status].label}</StatusBadge>,
    },
    {
      key: "conc",
      header: "Conciliación",
      cell: (mv) =>
        parseFloat(mv.importe) >= 0 ? (
          <StatusBadge tone={mv.conciliationStatus === "conciliado" ? "success" : "warning"}>{CONCILIATION_BADGE[mv.conciliationStatus ?? "pendiente"].label}</StatusBadge>
        ) : mv.conciliationStatus === "conciliado" ? (
          <StatusBadge tone="success">{EXPENSE_CONCILIATION_BADGE.label}</StatusBadge>
        ) : (
          <span className="text-xs text-muted-foreground">–</span>
        ),
    },
  ];

  const importColumns: EconomyColumn<BankImport>[] = [
    {
      key: "file",
      header: "Fichero",
      mobile: "title",
      cell: (imp) => (
        <>
          <div className="flex items-center gap-2 font-medium text-foreground">
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" />
            <span className="break-all">{imp.fileName}</span>
          </div>
          {imp.errorMessage && (
            <div className="mt-1 flex items-center gap-1 text-xs font-normal text-danger">
              <AlertCircle className="h-3 w-3 shrink-0" /> {imp.errorMessage}
            </div>
          )}
        </>
      ),
    },
    { key: "type", header: "Tipo", priority: "md", cell: (imp) => <span className="font-mono text-xs uppercase text-muted-foreground">{imp.fileType}</span> },
    { key: "rows", header: "Importados", align: "right", num: true, cell: (imp) => <span className="font-semibold text-info">{imp.importedRows}</span> },
    { key: "dups", header: "Duplicados", align: "right", num: true, priority: "md", cell: (imp) => <span className="text-muted-foreground">{imp.duplicatesSkipped}</span> },
    {
      key: "status",
      header: "Estado",
      cell: (imp) => <StatusBadge tone={imp.status === "ok" ? "success" : imp.status === "error" ? "danger" : "warning"}>{IMPORT_STATUS_BADGE[imp.status].label}</StatusBadge>,
    },
    { key: "date", header: "Fecha", priority: "md", cell: (imp) => <span className="text-xs text-muted-foreground">{new Date(imp.createdAt).toLocaleString("es-ES")}</span> },
  ];

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        <FinanceSyncSetupBanner />
        {/* Header */}
        <PanelPageHeader
          icon={<FileSpreadsheet />}
          title="Movimientos Bancarios"
          description="Importa, gestiona y concilia los movimientos de tu banco: Norma 43, Excel o CSV"
          actions={
            <>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
               
              >
                {uploading ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Importando...</>
                ) : (
                  <><Upload className="w-4 h-4 mr-2" /> Importar fichero</>
                )}
              </Button>
              <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv,.txt,.n43,.aeb,.q43" className="hidden" onChange={handleFileChange} />
            </>
          }
        />

        {/* Resumen */}
        <EconomySummary>
          <MetricCard icon={<FileSpreadsheet />} tone="info" label="Total movimientos" value={totalMovs} detail={`${imports.length} ${imports.length === 1 ? "importación" : "importaciones"}`} />
          <MetricCard icon={<TrendingUp />} tone="success" label="Total ingresado" value={fmtAmount(totalIngresado)} detail="abonos del filtro actual" />
          <MetricCard icon={<TrendingDown />} tone="danger" label="Total cargado" value={fmtAmount(totalCargado)} detail="cargos del filtro actual" />
          <MetricCard icon={<AlertCircle />} tone={sinConciliar > 0 ? "warning" : "success"} label="Sin conciliar (página)" value={sinConciliar} detail={`de ${movements.length} mostrados`} />
        </EconomySummary>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {(["movimientos", "importaciones"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "movimientos" ? "Movimientos" : `Importaciones (${imports.length})`}
            </button>
          ))}
        </div>

        {/* ── TAB: Movimientos ── */}
        {tab === "movimientos" && (
          <div className="space-y-4">
            <EconomyFilterBar
              search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Buscar movimiento o concepto..." }}
              primary={
                <>
                  <FilterField label="Estado" className="w-full sm:w-40">
                    <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v as any); setPage(1); }}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="pendiente">Pendiente</SelectItem>
                        <SelectItem value="ignorado">Ignorado</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Desde" className="w-[calc(50%-0.375rem)] sm:w-40">
                    <Input type="date" value={filterFechaFrom} onChange={(e) => { setFilterFechaFrom(e.target.value); setPage(1); }} />
                  </FilterField>
                  <FilterField label="Hasta" className="w-[calc(50%-0.375rem)] sm:w-40">
                    <Input type="date" value={filterFechaTo} onChange={(e) => { setFilterFechaTo(e.target.value); setPage(1); }} />
                  </FilterField>
                </>
              }
              more={
                <FilterField label="Importación">
                  <Select
                    value={filterImportId ? String(filterImportId) : "todos"}
                    onValueChange={(v) => { setFilterImportId(v === "todos" ? undefined : Number(v)); setPage(1); }}
                  >
                    <SelectTrigger className="w-full"><SelectValue placeholder="Todas las importaciones" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas las importaciones</SelectItem>
                      {imports.map((imp) => (
                        <SelectItem key={imp.id} value={String(imp.id)}>{imp.fileName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FilterField>
              }
              chips={movChips}
              onClear={clearMovFilters}
              summary={`${totalMovs} ${totalMovs === 1 ? "movimiento" : "movimientos"}`}
            />

            <EconomyTable
              rows={movements}
              columns={movColumns}
              rowKey={(mv) => mv.id}
              caption="Movimientos bancarios"
              loading={movementsQ.isLoading}
              error={movementsQ.error}
              errorTitle="No se han podido cargar los movimientos"
              onRetry={() => void movementsQ.refetch()}
              emptyTitle="No hay movimientos con los filtros seleccionados"
              emptyDescription="Cambia o quita algún filtro, o importa el extracto de tu banco."
              emptyAction={movChips.length > 0 ? <Button variant="outline" size="sm" onClick={clearMovFilters}>Limpiar filtros</Button> : undefined}
              rowClassName={(mv) => (mv.status === "ignorado" ? "opacity-60" : undefined)}
              onRowClick={openDetail}
              actions={(mv) => (
                <RowActions label={mv.movimiento || fmtDate(mv.fecha)} primary={{ label: "Revisar", icon: <Eye className="h-4 w-4" />, onSelect: () => openDetail(mv) }} />
              )}
              footer={totalPages > 1 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  <span className="tabular-nums">{totalMovs} registros · página {page}/{totalPages}</span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ) : undefined}
            />
          </div>
        )}

        {/* ── TAB: Importaciones ── */}
        {tab === "importaciones" && (
          <EconomyTable
            rows={imports}
            columns={importColumns}
            rowKey={(imp) => imp.id}
            caption="Importaciones de extractos"
            loading={importsQ.isLoading}
            error={importsQ.error}
            onRetry={() => void importsQ.refetch()}
            emptyTitle="No hay importaciones todavía"
            emptyDescription='Usa el botón "Importar fichero" para cargar el extracto de tu banco (Norma 43, Excel o CSV)'
            actions={(imp) => (
              <RowActions
                label={imp.fileName}
                menu={[{
                  label: "Eliminar importación",
                  icon: <Trash2 />,
                  destructive: true,
                  onSelect: async () => {
                    if (!(await confirmAction({ description: `¿Eliminar importación "${imp.fileName}" y todos sus movimientos?`, destructive: true }))) return;
                    deleteImportMut.mutate({ id: imp.id });
                  },
                }]}
              />
            )}
          />
        )}
      </div>

      {/* ── Movement detail modal ── */}
      <Dialog open={!!selectedMovement} onOpenChange={(o) => !o && setSelectedMovement(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Detalle del movimiento
              {selectedMovement && (() => {
                const isNeg = parseFloat(selectedMovement.importe) < 0;
                const isManual = confirmedLink?.entityType === "manual";
                const badge = isManual
                  ? MANUAL_CONCILIATION_BADGE
                  : isNeg && selectedMovement.conciliationStatus === "conciliado"
                    ? EXPENSE_CONCILIATION_BADGE
                    : CONCILIATION_BADGE[selectedMovement.conciliationStatus ?? "pendiente"];
                return <Badge className={badge.cls}>{badge.label}</Badge>;
              })()}
            </DialogTitle>
          </DialogHeader>

          {selectedMovement && (
            <div className="space-y-5">
              {/* Datos del movimiento */}
              <FormSection title="Datos del movimiento">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Fecha</div>
                  <div className="font-medium">{fmtDate(selectedMovement.fecha)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Fecha valor</div>
                  <div className="font-medium">{fmtDate(selectedMovement.fechaValor)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-muted-foreground mb-1">Movimiento</div>
                  <div className="font-medium">{selectedMovement.movimiento || "–"}</div>
                </div>
                {selectedMovement.masDatos && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Más datos</div>
                    <div className="text-foreground text-xs break-words">{selectedMovement.masDatos}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Importe</div>
                  <div className={`text-lg font-bold ${parseFloat(selectedMovement.importe) >= 0 ? "text-success" : "text-danger"}`}>
                    {fmtAmount(selectedMovement.importe)}
                  </div>
                </div>
                {selectedMovement.saldo && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">Saldo</div>
                    <div className="font-medium">{fmtAmount(selectedMovement.saldo)}</div>
                  </div>
                )}
              </div>
              </FormSection>

              {/* ── Sección conciliación (solo ingresos) ── */}
              {isPositive && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-info" />
                      Conciliación bancaria
                    </h3>
                    {isConciliated ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-danger border-danger/40 hover:bg-danger/10 text-xs"
                        onClick={() => setUnlinkConfirm(true)}
                      >
                        <Link2Off className="w-3.5 h-3.5 mr-1" /> Desvincular
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-info border-info/40 hover:bg-info/10 text-xs"
                        onClick={() => setShowMatches(!showMatches)}
                      >
                        <Sparkles className="w-3.5 h-3.5 mr-1" />
                        {showMatches ? "Ocultar propuestas" : "Buscar coincidencias"}
                      </Button>
                    )}
                  </div>

                  {/* Vínculo confirmado */}
                  {isConciliated && confirmedLink && (
                    <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
                      <div className="flex items-center gap-2 text-success font-medium mb-2">
                        <CheckCircle className="w-4 h-4" /> Conciliado con presupuesto
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-success">
                        <span>Entidad: {confirmedLink.entityType} #{confirmedLink.entityId}</span>
                        <span>Importe: {fmtAmount(confirmedLink.amountLinked)}</span>
                        <span>Por: {confirmedLink.matchedBy ?? "–"}</span>
                        <span>Fecha: {confirmedLink.matchedAt ? fmtDate(confirmedLink.matchedAt) : "–"}</span>
                      </div>
                    </div>
                  )}

                  {/* Panel de propuestas */}
                  {!isConciliated && showMatches && (
                    <div className="space-y-2">
                      {matchesQ.isLoading ? (
                        <div className="text-sm text-muted-foreground text-center py-4">
                          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Buscando coincidencias...
                        </div>
                      ) : matches.length === 0 ? (
                        <div className="rounded-lg border border-border bg-muted p-4 text-center text-sm text-muted-foreground">
                          <Info className="w-4 h-4 inline mr-1" />
                          No se encontraron presupuestos pendientes que coincidan con este ingreso.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {matches.length} presupuesto{matches.length > 1 ? "s" : ""} posible{matches.length > 1 ? "s" : ""} encontrado{matches.length > 1 ? "s" : ""}
                          </p>
                          {matches.map((m) => (
                            <div
                              key={m.quoteId}
                              className={`rounded-lg border p-3 text-sm space-y-2 ${m.isRejected ? "opacity-50 border-border bg-muted" : "border-info/40 bg-info/10"}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-foreground">{m.quoteNumber} — {m.title}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {m.clientName && <span>{m.clientName} · </span>}
                                    {m.clientEmail && <span>{m.clientEmail} · </span>}
                                    Total: <span className="font-medium text-foreground">{fmtAmount(m.total)}</span>
                                  </div>
                                  {m.sentAt && (
                                    <div className="text-xs text-muted-foreground">Enviado: {fmtDate(m.sentAt)}</div>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreColor(m.confidenceScore)}`}>
                                    {m.confidenceScore}% coincidencia
                                  </span>
                                  {m.isRejected && <span className="text-xs text-muted-foreground">Rechazado</span>}
                                </div>
                              </div>

                              {confirmingQuoteId === m.quoteId ? (
                                <div className="rounded-md border border-warning/40 bg-warning/10 p-3 space-y-2">
                                  <p className="text-xs text-warning font-medium">
                                    ¿Confirmar conciliación?
                                  </p>
                                  <p className="text-xs text-warning">
                                    Este movimiento del {fmtDate(selectedMovement.fecha)} por {fmtAmount(selectedMovement.importe)} quedará vinculado
                                    al presupuesto <strong>{m.quoteNumber}</strong> y se generará la reserva y factura correspondiente.
                                  </p>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className=" text-xs"
                                      disabled={confirmTransferMut.isPending}
                                      onClick={() => {
                                        confirmTransferMut.mutate({
                                          quoteId: m.quoteId,
                                          bankMovementId: selectedMovement.id,
                                        });
                                      }}
                                    >
                                      {confirmTransferMut.isPending
                                        ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Procesando...</>
                                        : <><CheckCircle className="w-3 h-3 mr-1" />Sí, confirmar</>
                                      }
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setConfirmingQuoteId(null)}>
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>
                              ) : rejectingQuoteId === m.quoteId ? (
                                <div className="rounded-md border border-border bg-muted p-3 space-y-2">
                                  <p className="text-xs text-foreground">¿Rechazar esta propuesta? No se modificará nada.</p>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs border-danger/40 text-danger hover:bg-danger/10"
                                      disabled={rejectLinkMut.isPending}
                                      onClick={() => rejectLinkMut.mutate({ bankMovementId: selectedMovement.id, quoteId: m.quoteId })}
                                    >
                                      {rejectLinkMut.isPending ? "..." : "Sí, rechazar"}
                                    </Button>
                                    <Button size="sm" variant="outline" className="text-xs" onClick={() => setRejectingQuoteId(null)}>
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className=" text-xs"
                                    onClick={() => setConfirmingQuoteId(m.quoteId)}
                                  >
                                    <CheckCircle className="w-3 h-3 mr-1" /> Aceptar conciliación
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs text-muted-foreground"
                                    onClick={() => setRejectingQuoteId(m.quoteId)}
                                  >
                                    <ThumbsDown className="w-3 h-3 mr-1" /> Rechazar
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
                      <summary className="cursor-pointer text-muted-foreground hover:text-muted-foreground">Ver historial de vínculos ({(linksQ.data as unknown as BankMovementLink[]).length})</summary>
                      <div className="mt-2 space-y-1 pl-2 border-l-2 border-border">
                        {(linksQ.data as unknown as BankMovementLink[]).map(l => (
                          <div key={l.id} className="text-muted-foreground">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-1 ${
                              l.status === "confirmed" ? "bg-success/10 text-success" :
                              l.status === "rejected" ? "bg-danger/10 text-danger" :
                              l.status === "unlinked" ? "bg-muted text-muted-foreground" :
                              "bg-info/10 text-info"
                            }`}>{l.status}</span>
                            {l.entityType} #{l.entityId} · {fmtAmount(l.amountLinked)}
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      Conciliación manual
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-primary border-primary/40 hover:bg-primary/10 text-xs"
                      onClick={() => setShowManualForm(!showManualForm)}
                    >
                      {showManualForm ? "Cancelar" : "Justificar manualmente"}
                    </Button>
                  </div>
                  {showManualForm && (
                    <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 space-y-3">
                      <p className="text-xs text-primary">
                        Usa esto cuando el movimiento no corresponde a ninguna operación del sistema (transferencias internas, cuotas bancarias, impuestos, etc.).
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground font-medium">Tipo de movimiento *</label>
                        <Select value={manualType} onValueChange={setManualType}>
                          <SelectTrigger className="text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="transferencia_interna">Transferencia interna</SelectItem>
                            <SelectItem value="comision_bancaria">Comisión / cuota bancaria</SelectItem>
                            <SelectItem value="pago_impuesto">Pago de impuesto / hacienda</SelectItem>
                            <SelectItem value="ajuste_contable">Ajuste contable</SelectItem>
                            <SelectItem value="devolucion">Devolución / reembolso</SelectItem>
                            <SelectItem value="otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground font-medium">Contraparte</label>
                        <Input
                          className="text-sm"
                          value={manualCounterparty}
                          onChange={(e) => setManualCounterparty(e.target.value)}
                          placeholder="Ej: CaixaBank, NEXTAIR S.L., Agencia Tributaria…"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground font-medium">Justificación *</label>
                        <textarea
                          className="w-full text-sm border border-primary/40 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-primary/40 bg-card"
                          rows={2}
                          value={manualNotes}
                          onChange={(e) => setManualNotes(e.target.value)}
                          placeholder="Describe brevemente el motivo de este movimiento…"
                        />
                      </div>
                      <Button
                        size="sm"
                        className=" text-xs w-full"
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
                        {manuallyConciliateMut.isPending ? "Guardando..." : "Confirmar conciliación manual"}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Info cuando está conciliado manualmente */}
              {isConciliated && confirmedLink?.entityType === "manual" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-primary" />
                      Conciliación manual
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-danger border-danger/40 hover:bg-danger/10 text-xs"
                      onClick={() => setUnlinkConfirm(true)}
                    >
                      <Link2Off className="w-3.5 h-3.5 mr-1" /> Desvincular
                    </Button>
                  </div>
                  <div className="rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                    <div className="flex items-center gap-2 text-primary font-medium mb-1">
                      <CheckCircle className="w-4 h-4" /> Justificado manualmente
                    </div>
                    <p className="text-xs text-primary">{confirmedLink.notes ?? "—"}</p>
                    <div className="text-xs text-primary mt-1">
                      Por {confirmedLink.matchedBy ?? "–"} · {confirmedLink.matchedAt ? fmtDate(confirmedLink.matchedAt) : "–"}
                    </div>
                  </div>
                </div>
              )}

              {/* Estado y notas */}
              <FormSection title="Estado y notas">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Estado</label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as "pendiente" | "ignorado")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-warning" /> Pendiente</span>
                      </SelectItem>
                      <SelectItem value="ignorado">
                        <span className="flex items-center gap-2"><MinusCircle className="w-4 h-4 text-muted-foreground" /> Ignorado</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Notas internas</label>
                  <textarea
                    className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm focus:outline-none focus:ring-1 focus:ring-info/40"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notas opcionales sobre este movimiento..."
                  />
                </div>
              </FormSection>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedMovement(null)}>Cancelar</Button>
                <Button onClick={saveDetail} disabled={savingDetail}>
                  {savingDetail ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirmar desvinculación ── */}
      <Dialog open={unlinkConfirm} onOpenChange={setUnlinkConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Desvincular conciliación</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se romperá el vínculo contable entre este movimiento bancario y el presupuesto asociado.
            <strong> La reserva y la factura no se modificarán.</strong>
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUnlinkConfirm(false)}>Cancelar</Button>
            <Button
              className="bg-danger hover:bg-danger/90 text-primary-foreground"
              disabled={unlinkMut.isPending}
              onClick={() => {
                if (selectedMovement) unlinkMut.mutate({ bankMovementId: selectedMovement.id });
              }}
            >
              {unlinkMut.isPending ? "Desvinculando..." : "Desvincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
