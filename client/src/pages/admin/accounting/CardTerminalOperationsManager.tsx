import { useState, useRef, useEffect } from "react";
import { confirmAction } from "@/components/admin/ConfirmHost";
import AdminLayout from "@/components/AdminLayout";
import { EconomyShell } from "@/components/admin/EconomyShell";
import { formatEur } from "@/lib/money";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard, PageOnlyTag, EconomyFilterBar, EconomySummary, EconomyTable, FilterField, FormSection, RowActions, type EconomyColumn, type FilterChip, type RowAction } from "./shared/EconomyUi";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import {
  Upload,
  Search,
  Wallet,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Link,
  MoreHorizontal,
  Unlink,
  AlertTriangle,
  Eye,
  X,
  Trash2,
  CreditCard,
  Mail,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const IMAP_ALLOWED_SENDER_LABEL = "copia@ticket.comerciaglobalpay.com";

type OpStatus = "pendiente" | "conciliado" | "incidencia" | "ignorado" | "todos";
type OpType = "VENTA" | "DEVOLUCION" | "ANULACION" | "OTRO" | "todos";

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  pendiente:         { label: "Pendiente",       tone: "warning" },
  conciliado:        { label: "Conciliado",       tone: "success" },
  incidencia:        { label: "Incidencia",       tone: "danger" },
  ignorado:          { label: "Ignorado",         tone: "neutral" },
  included_in_batch: { label: "En remesa",        tone: "info" },
  settled:           { label: "Liquidado",        tone: "success" },
};

const TYPE_LABELS: Record<string, { label: string; tone: Tone }> = {
  VENTA: { label: "Venta", tone: "info" },
  DEVOLUCION: { label: "Devolución", tone: "warning" },
  ANULACION: { label: "Anulación", tone: "danger" },
  OTRO: { label: "Otro", tone: "neutral" },
};

const fmtCurrency = (v: string | number | null | undefined): string => formatEur(v);

function fmtDatetime(v: string | Date | null | undefined): string {
  if (!v) return "-";
  return new Date(v).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

export default function CardTerminalOperationsManager() {
  const utils = trpc.useUtils();

  // Filters
  const [statusFilter, setStatusFilter] = useState<OpStatus>("todos");
  const [typeFilter, setTypeFilter] = useState<OpType>("todos");
  const [search, setSearch] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("search") ?? ""; } catch { return ""; }
  });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

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
  const [showEmailLogs, setShowEmailLogs] = useState(false);

  // Queries
  const listQ = trpc.cardTerminalOperations.list.useQuery(
    {
      status: statusFilter,
      operationType: typeFilter,
      search: search || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize: PAGE_SIZE,
    },
    { refetchOnWindowFocus: false }
  );

  const importsQ = trpc.cardTerminalOperations.listImports.useQuery(undefined, { refetchOnWindowFocus: false });

  const emailLogsQ = trpc.emailIngestion.listLogs.useQuery(
    { limit: 50 },
    { enabled: showEmailLogs, refetchOnWindowFocus: false }
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

  // Mutations
  const importMut = trpc.cardTerminalOperations.importExcel.useMutation({
    onSuccess: (data) => {
      setImportResult(data);
      utils.cardTerminalOperations.list.invalidate();
      utils.cardTerminalOperations.listImports.invalidate();
    },
  });

  const linkMut = trpc.cardTerminalOperations.linkManually.useMutation({
    onSuccess: () => {
      utils.cardTerminalOperations.list.invalidate();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      resetLinkModal();
    },
  });

  const incidentMut = trpc.cardTerminalOperations.markIncident.useMutation({
    onSuccess: () => {
      utils.cardTerminalOperations.list.invalidate();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      setIncidentId(null);
      setIncidentReason("");
    },
  });

  const unlinkMut = trpc.cardTerminalOperations.unlink.useMutation({
    onSuccess: () => {
      utils.cardTerminalOperations.list.invalidate();
      if (detailId) utils.cardTerminalOperations.getById.invalidate({ id: detailId });
      setUnlinkId(null);
      setUnlinkNotes("");
    },
  });

  const updateStatusMut = trpc.cardTerminalOperations.updateStatus.useMutation({
    onSuccess: () => {
      utils.cardTerminalOperations.list.invalidate();
    },
  });

  const deleteImportMut = trpc.cardTerminalOperations.deleteImport.useMutation({
    onSuccess: () => {
      utils.cardTerminalOperations.list.invalidate();
      utils.cardTerminalOperations.listImports.invalidate();
      setDeleteImportId(null);
    },
  });

  const syncEmailMut = trpc.emailIngestion.triggerSync.useMutation({
    onSuccess: (data) => {
      setSyncResult(data);
      utils.cardTerminalOperations.list.invalidate();
      utils.emailIngestion.listLogs.invalidate();
    },
    onSettled: () => setSyncing(false),
  });

  const resetLogsMut = trpc.emailIngestion.resetLogsForDate.useMutation({
    onSuccess: (data) => {
      utils.emailIngestion.listLogs.invalidate();
      toast.success(`${data.reset} log(s) reseteado(s). Pulsa "Sincronizar correo TPV" para reprocesar.`);
    },
  });

  const repairStatusMut = trpc.cardTerminalOperations.repairLinkedStatus.useMutation({
    onSuccess: (data) => {
      utils.cardTerminalOperations.list.invalidate();
      toast.success(`${data.fixed} operación(es) reparada(s) → estado "Conciliado".`);
    },
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
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resetFilters() {
    setStatusFilter("todos");
    setTypeFilter("todos");
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  const ops = listQ.data?.data ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  type Op = (typeof ops)[number];
  const pendientes = ops.filter((o) => o.status === "pendiente").length;
  const incidencias = ops.filter((o) => o.status === "incidencia").length;
  const dateChip = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString("es-ES");
  const chips: FilterChip[] = [
    ...(search ? [{ id: "q", label: `Búsqueda: ${search}`, onRemove: () => { setSearch(""); setPage(1); } }] : []),
    ...(statusFilter !== "todos" ? [{ id: "status", label: `Estado: ${STATUS_LABELS[statusFilter]?.label ?? statusFilter}`, onRemove: () => { setStatusFilter("todos"); setPage(1); } }] : []),
    ...(typeFilter !== "todos" ? [{ id: "type", label: `Tipo: ${TYPE_LABELS[typeFilter]?.label ?? typeFilter}`, onRemove: () => { setTypeFilter("todos"); setPage(1); } }] : []),
    ...(dateFrom ? [{ id: "from", label: `Desde ${dateChip(dateFrom)}`, onRemove: () => { setDateFrom(""); setPage(1); } }] : []),
    ...(dateTo ? [{ id: "to", label: `Hasta ${dateChip(dateTo)}`, onRemove: () => { setDateTo(""); setPage(1); } }] : []),
  ];

  const columns: EconomyColumn<Op>[] = [
    {
      key: "fecha",
      header: "Fecha",
      mobile: "title",
      cell: (op) => (
        <>
          <span className="whitespace-nowrap">{fmtDatetime(op.operationDatetime)}</span>
          <span className="mt-0.5 block font-mono text-xs font-normal text-muted-foreground">{op.operationNumber || "-"}</span>
        </>
      ),
    },
    { key: "terminal", header: "Terminal", priority: "xl", cell: (op) => <span className="text-xs text-muted-foreground">{op.terminalCode || "-"}</span> },
    {
      key: "tipo",
      header: "Tipo",
      cell: (op) => {
        const typeInfo = TYPE_LABELS[op.operationType] ?? TYPE_LABELS.OTRO;
        return <StatusBadge tone={typeInfo.tone}>{typeInfo.label}</StatusBadge>;
      },
    },
    {
      key: "importe",
      header: "Importe",
      align: "right",
      num: true,
      mobile: "amount",
      cell: (op) => <span className={`font-semibold ${op.operationType === "DEVOLUCION" ? "text-warning" : "text-success"}`}>{fmtCurrency(String(op.amount))}</span>,
    },
    { key: "tarjeta", header: "Tarjeta", priority: "lg", cell: (op) => <span className="font-mono text-xs">{op.card ? `****${op.card.slice(-4)}` : "-"}</span> },
    {
      key: "estado",
      header: "Estado",
      cell: (op) => {
        const statusInfo = STATUS_LABELS[op.status] ?? STATUS_LABELS.pendiente;
        return <StatusBadge tone={statusInfo.tone}>{statusInfo.label}</StatusBadge>;
      },
    },
    {
      key: "link",
      header: "Vinculado a",
      priority: "md",
      cell: (op) =>
        op.linkedEntityType && op.linkedEntityType !== "none" ? (
          op.linkedEntityType === "reservation" ? (
            <a
              href={`/admin/crm?tab=reservations&search=${encodeURIComponent((op as any).linkedReservationNumber ?? String(op.linkedEntityId))}`}
              className="text-xs font-medium text-info hover:text-info hover:underline"
            >
              {(op as any).linkedReservationNumber ?? `#${op.linkedEntityId}`}
            </a>
          ) : (
            <span className="text-xs font-medium text-warning">Presupuesto #{op.linkedEntityId}</span>
          )
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  const rowActions = (op: Op) => {
    const openLink = () => { setLinkModalId(op.id); setLinkModalAmount(parseFloat(op.amount)); setLinkModalOpType((op as any).operation_type ?? (op as any).operationType ?? null); };
    const menu: RowAction[] = [{ label: "Ver detalle", icon: <Eye />, onSelect: () => setDetailId(op.id) }];
    if (op.status === "pendiente") menu.push({ label: "Ignorar", icon: <X />, onSelect: () => updateStatusMut.mutate({ id: op.id, status: "ignorado" }) });
    if (op.status !== "incidencia" && op.status !== "conciliado") menu.push({ label: "Marcar incidencia", icon: <AlertTriangle />, destructive: true, onSelect: () => setIncidentId(op.id) });
    return (
      <RowActions
        label={op.operationNumber || fmtDatetime(op.operationDatetime)}
        primary={
          op.status === "conciliado"
            ? { label: "Desvincular", icon: <Unlink className="h-4 w-4" />, onSelect: () => setUnlinkId(op.id) }
            : { label: "Vincular", icon: <Link className="h-4 w-4" />, onSelect: openLink }
        }
        menu={menu}
      />
    );
  };

  return (
    <AdminLayout>
      <EconomyShell screen="pos"
        description="Datafono / Terminal Físico — Comercia Global Payments"
        action={
          <>
            <Button variant="outline" size="sm" onClick={() => listQ.refetch()}>
              <RefreshCw className="w-4 h-4 mr-1" /> Actualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Más acciones de operaciones TPV">
                  <MoreHorizontal className="w-4 h-4 mr-1" /> Más
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={syncing}
                  onSelect={() => {
                    setSyncing(true);
                    setSyncResult(null);
                    syncEmailMut.mutate({ retryErrors: false });
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" /> {syncing ? "Sincronizando..." : "Sincronizar correo TPV"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const date = prompt("Fecha a reprocesar (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
                    if (date && /^d{4}-d{2}-d{2}$/.test(date)) {
                      resetLogsMut.mutate({ date });
                    }
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Reprocesar fecha
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    if ((await confirmAction({ description: "¿Reparar operaciones enlazadas con estado incorrecto? Se pondrán en 'Conciliado'." }))) {
                      repairStatusMut.mutate();
                    }
                  }}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Reparar estados
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => { setShowImportModal(true); setImportResult(null); }}>
              <Upload className="w-4 h-4 mr-1" /> Importar Excel/PDF
            </Button>
          </>
        }>
    <div className="space-y-6">

      {/* Email sync result */}
      {syncResult && (
        <div className={`rounded-lg border p-4 text-sm ${syncResult.errors.length > 0 ? "bg-danger/10 border-danger/40" : "bg-success/10 border-success/40"}`}>
          <div className="flex items-center justify-between">
            <div className="font-medium">
              {syncResult.errors.length > 0 ? "Sincronización con errores" : "Sincronización completada"}
            </div>
            <button onClick={() => setSyncResult(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-1 text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            <span>Emails revisados: <b>{syncResult.messagesChecked}</b></span>
            <span>Procesados: <b>{syncResult.messagesProcessed}</b></span>
            <span>Detectadas: <b>{syncResult.operationsDetected}</b></span>
            <span>Nuevas: <b className="text-success">{syncResult.operationsInserted}</b></span>
            <span>Vinculadas: <b className="text-info">{syncResult.operationsLinked}</b></span>
            <span>Duplicadas: <b>{syncResult.operationsDuplicate}</b></span>
            {syncResult.operationsFailed > 0 && (
              <span>Fallidas: <b className="text-danger">{syncResult.operationsFailed}</b></span>
            )}
          </div>
          {syncResult.errors.length > 0 && (
            <ul className="mt-2 text-danger list-disc list-inside">
              {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Resumen */}
      <EconomySummary>
        <MetricCard icon={<CreditCard />} tone="info" label="Total operaciones" value={total} detail={<>{pendientes} pendientes · {incidencias} con incidencia <PageOnlyTag /></>} />
        <MetricCard icon={<TrendingUp />} tone="success" label="Total ventas" value={fmtCurrency(listQ.data?.totalVentas ?? 0)} detail="importe cobrado en datáfono" />
        <MetricCard icon={<TrendingDown />} tone="warning" label="Total devoluciones" value={fmtCurrency(listQ.data?.totalDevoluciones ?? 0)} detail="importe devuelto" />
        <MetricCard icon={<Wallet />} tone={(listQ.data?.totalVentas ?? 0) - (listQ.data?.totalDevoluciones ?? 0) >= 0 ? "success" : "danger"} label="Neto" value={fmtCurrency((listQ.data?.totalVentas ?? 0) - (listQ.data?.totalDevoluciones ?? 0))} detail="ventas − devoluciones" />
      </EconomySummary>

      {/* Filtros */}
      <EconomyFilterBar
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Nº op, tarjeta, terminal..." }}
        primary={
          <>
            <FilterField label="Estado" className="w-full sm:w-40">
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as OpStatus); setPage(1); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="conciliado">Conciliado</SelectItem>
                  <SelectItem value="incidencia">Incidencia</SelectItem>
                  <SelectItem value="ignorado">Ignorado</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Tipo" className="w-full sm:w-40">
              <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as OpType); setPage(1); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="VENTA">Venta</SelectItem>
                  <SelectItem value="DEVOLUCION">Devolución</SelectItem>
                  <SelectItem value="ANULACION">Anulación</SelectItem>
                  <SelectItem value="OTRO">Otro</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </>
        }
        more={
          <>
            <FilterField label="Desde">
              <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
            </FilterField>
            <FilterField label="Hasta">
              <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
            </FilterField>
          </>
        }
        chips={chips}
        onClear={resetFilters}
        summary={`${total} ${total === 1 ? "operación" : "operaciones"}`}
      />

      {/* Tabla */}
      <EconomyTable
        rows={ops}
        columns={columns}
        rowKey={(op) => op.id}
        caption="Operaciones del datáfono"
        loading={listQ.isLoading}
        error={listQ.error}
        errorTitle="No se han podido cargar las operaciones"
        onRetry={() => void listQ.refetch()}
        emptyTitle="No hay operaciones"
        emptyDescription="Importa el fichero del datáfono o sincroniza el correo del TPV para traer operaciones."
        emptyAction={chips.length > 0 ? <Button variant="outline" size="sm" onClick={resetFilters}>Limpiar filtros</Button> : undefined}
        onRowClick={(op) => setDetailId(op.id)}
        actions={rowActions}
        footer={totalPages > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
            <p className="text-sm tabular-nums text-muted-foreground">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <span className="flex items-center px-2 text-sm tabular-nums">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          </div>
        ) : undefined}
      />

      {/* Email ingestion logs */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <button
          className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 text-sm font-medium"
          onClick={() => setShowEmailLogs((v) => !v)}
        >
          <span className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-muted-foreground" />
            Logs de ingesta por email
          </span>
          {showEmailLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showEmailLogs && (
          <div>
            <div className="flex items-center justify-between px-4 py-2 border-t bg-muted/10">
              <span className="text-xs text-muted-foreground">
                {emailLogsQ.data?.length ?? 0} registros · solo emails de {IMAP_ALLOWED_SENDER_LABEL}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={() => {
                  setSyncing(true);
                  setSyncResult(null);
                  syncEmailMut.mutate({ retryErrors: true });
                }}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Reintentar fallidos
              </Button>
            </div>
            <div className="overflow-x-auto">
              {emailLogsQ.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Cargando...</p>
              ) : (emailLogsQ.data?.length ?? 0) === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Sin registros todavía.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Fecha</th>
                      <th className="text-left p-2">Asunto</th>
                      <th className="text-left p-2">Estado</th>
                      <th className="text-left p-2">Fuente</th>
                      <th className="text-right p-2">Det.</th>
                      <th className="text-right p-2">Ins.</th>
                      <th className="text-right p-2">Vinc.</th>
                      <th className="text-right p-2">Dup.</th>
                      <th className="text-right p-2">Fail</th>
                      <th className="text-right p-2">Ret.</th>
                      <th className="text-left p-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emailLogsQ.data!.map((log) => (
                      <tr key={log.id} className="border-t hover:bg-muted/20">
                        <td className="p-2 whitespace-nowrap">{fmtDatetime(log.createdAt)}</td>
                        <td className="p-2 max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap" title={log.subject ?? ""}>{log.subject ?? "-"}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                            log.status === "ok" ? "bg-success/10 text-success"
                            : log.status === "error" ? "bg-danger/10 text-danger"
                            : "bg-muted text-muted-foreground"
                          }`}>{log.status}</span>
                        </td>
                        <td className="p-2">
                          {log.parsingStrategy ? (
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              log.parsingStrategy === "pdf" ? "bg-warning/10 text-warning"
                              : log.parsingStrategy === "excel" ? "bg-info/10 text-info"
                              : "bg-muted text-muted-foreground"
                            }`}>{log.parsingStrategy}</span>
                          ) : "-"}
                        </td>
                        <td className="p-2 text-right">{log.operationsDetected ?? 0}</td>
                        <td className="p-2 text-right font-medium text-success">{log.operationsInserted}</td>
                        <td className="p-2 text-right text-info">{log.operationsLinked ?? 0}</td>
                        <td className="p-2 text-right text-muted-foreground">{log.operationsDuplicate}</td>
                        <td className="p-2 text-right text-danger">{log.operationsFailed ?? 0}</td>
                        <td className="p-2 text-right text-muted-foreground">{log.retryCount ?? 0}</td>
                        <td className="p-2 text-danger max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap" title={log.errorMessage ?? ""}>{log.errorMessage ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Import history */}
      {importsQ.data && importsQ.data.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="font-semibold mb-3 text-sm">Historial de importaciones</h3>
          <div className="space-y-2">
            {importsQ.data.map((imp) => (
              <div key={imp.id} className="flex items-center justify-between text-sm bg-muted/30 rounded p-2">
                <span className="font-medium">{imp.fileName}</span>
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground text-xs">
                    {new Date(imp.createdAt).toLocaleDateString("es-ES")}
                  </span>
                  <Badge variant={imp.status === "ok" ? "default" : "destructive"} className="text-xs">
                    {imp.status === "ok" ? `${imp.importedRows} filas` : "Error"}
                  </Badge>
                  {imp.duplicatesSkipped > 0 && (
                    <span className="text-muted-foreground text-xs">{imp.duplicatesSkipped} duplicados</span>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteImportId(imp.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Import Modal ── */}
      <Dialog open={showImportModal} onOpenChange={setShowImportModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Importar operaciones TPV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sube el extracto de Comercia Global Payments (CaixaBank) en formato Excel (.xlsx, .xls) o CSV.
              Las operaciones duplicadas se omitirán automáticamente.
            </p>
            {!importResult ? (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {importing ? (
                  <div className="space-y-2">
                    <RefreshCw className="w-8 h-8 mx-auto animate-spin text-primary" />
                    <p className="text-sm">Procesando...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">Haz clic o arrastra el archivo</p>
                    <p className="text-xs text-muted-foreground">.xlsx, .xls, .csv</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-success/10 border border-success/40 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-success">Importación completada</p>
                <p className="text-sm text-success">{importResult.importedRows} operaciones importadas</p>
                {importResult.duplicatesSkipped > 0 && (
                  <p className="text-sm text-muted-foreground">{importResult.duplicatesSkipped} duplicados omitidos</p>
                )}
                {importResult.autoLinked > 0 && (
                  <p className="text-sm text-info">{importResult.autoLinked} auto-vinculadas a reservas/presupuestos</p>
                )}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleFileImport}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportModal(false)}>Cerrar</Button>
            {importResult && (
              <Button onClick={() => { setImportResult(null); fileInputRef.current?.click(); }}>
                Importar otro
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail Modal ── */}
      <Dialog open={detailId !== null} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle operación TPV</DialogTitle>
          </DialogHeader>
          {detailQ.data ? (
            <div className="space-y-4 text-sm">
              <FormSection title="Operación">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Fecha</p><p className="font-medium">{fmtDatetime(detailQ.data.operationDatetime)}</p></div>
                <div><p className="text-xs text-muted-foreground">Nº Operación</p><p className="font-mono">{detailQ.data.operationNumber || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Importe</p><p className="font-bold text-lg">{fmtCurrency(String(detailQ.data.amount))}</p></div>
                <div><p className="text-xs text-muted-foreground">Tipo</p>
                  <StatusBadge tone={TYPE_LABELS[detailQ.data.operationType]?.tone ?? "neutral"}>{TYPE_LABELS[detailQ.data.operationType]?.label}</StatusBadge>
                </div>
                <div><p className="text-xs text-muted-foreground">Tarjeta</p><p className="font-mono">{detailQ.data.card ? `****${detailQ.data.card.slice(-4)}` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Autorización</p><p className="font-mono">{detailQ.data.authorizationCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Terminal</p><p>{detailQ.data.terminalCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Comercio</p><p>{detailQ.data.commerceCode || "-"}</p></div>
              </div>
              </FormSection>
              <FormSection title="Estado y vinculación">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Estado</p>
                  <StatusBadge tone={STATUS_LABELS[detailQ.data.status]?.tone ?? "neutral"}>{STATUS_LABELS[detailQ.data.status]?.label}</StatusBadge>
                </div>
                <div><p className="text-xs text-muted-foreground">Vinculado a</p>
                  <p>{detailQ.data.linkedEntityType && detailQ.data.linkedEntityType !== "none"
                    ? `${detailQ.data.linkedEntityType === "reservation" ? "Reserva" : "Presupuesto"} #${detailQ.data.linkedEntityId}`
                    : "—"}</p>
                </div>
                {detailQ.data.linkedAt && (
                  <div><p className="text-xs text-muted-foreground">Vinculado el</p><p>{fmtDatetime(detailQ.data.linkedAt)}</p></div>
                )}
                {detailQ.data.linkedBy && (
                  <div><p className="text-xs text-muted-foreground">Vinculado por</p><p>{detailQ.data.linkedBy}</p></div>
                )}
              </div>
              </FormSection>
              {detailQ.data.incidentReason && (
                <div className="bg-danger/10 border border-danger/40 rounded p-3">
                  <p className="text-xs text-danger font-medium mb-1">Motivo incidencia</p>
                  <p className="text-sm">{detailQ.data.incidentReason}</p>
                </div>
              )}
              {detailQ.data.notes && (
                <div><p className="text-xs text-muted-foreground">Notas</p><p>{detailQ.data.notes}</p></div>
              )}
              <div className="flex gap-2 pt-2">
                {detailQ.data.status !== "conciliado" && (
                  <Button size="sm" variant="outline" onClick={() => { setLinkModalId(detailId); setLinkModalAmount(detailQ.data ? parseFloat(detailQ.data.amount) : null); setLinkModalOpType(detailQ.data ? ((detailQ.data as any).operation_type ?? (detailQ.data as any).operationType ?? null) : null); setDetailId(null); }}>
                    <Link className="w-3.5 h-3.5 mr-1" /> Vincular
                  </Button>
                )}
                {detailQ.data.status === "conciliado" && (
                  <Button size="sm" variant="outline" className="text-warning" onClick={() => { setUnlinkId(detailId); setDetailId(null); }}>
                    <Unlink className="w-3.5 h-3.5 mr-1" /> Desvincular
                  </Button>
                )}
                {detailQ.data.status !== "incidencia" && detailQ.data.status !== "conciliado" && (
                  <Button size="sm" variant="outline" className="text-danger" onClick={() => { setIncidentId(detailId); setDetailId(null); }}>
                    <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Incidencia
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">Cargando...</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailId(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Link Manual Modal ── */}
      <Dialog open={linkModalId !== null} onOpenChange={(o) => { if (!o) resetLinkModal(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular manualmente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tipo de entidad</Label>
              <Select value={linkEntityType} onValueChange={(v) => { setLinkEntityType(v as "reservation" | "quote"); setLinkSelectedId(null); setLinkSearch(""); }}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="reservation">Reserva</SelectItem>
                  <SelectItem value="quote">Presupuesto (ID manual)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {linkEntityType === "reservation" ? (
              <div className="space-y-2">
                <Label>Buscar reserva</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Nombre cliente o nº reserva…"
                    value={linkSearch}
                    onChange={(e) => { setLinkSearch(e.target.value); setLinkSelectedId(null); }}
                  />
                </div>
                {linkModalAmount !== null && !linkSearch && (
                  <p className="text-xs text-muted-foreground">
                    {linkModalOpType === "DEVOLUCION" || linkModalOpType === "ANULACION"
                      ? `Mostrando todas las reservas (esta operación es una ${linkModalOpType.toLowerCase()}, puede vincularse a una reserva ya enlazada)`
                      : `Mostrando reservas sin vincular con importe ${fmtCurrency(linkModalAmount)}`}
                  </p>
                )}
                <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                  {unlinkedResQ.isLoading && (
                    <p className="text-xs text-muted-foreground p-3">Buscando…</p>
                  )}
                  {!unlinkedResQ.isLoading && (unlinkedResQ.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground p-3">Sin resultados</p>
                  )}
                  {(unlinkedResQ.data ?? []).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center hover:bg-muted transition-colors ${linkSelectedId === r.id ? "bg-primary/10 font-medium" : ""}`}
                      onClick={() => setLinkSelectedId(r.id)}
                    >
                      <span>
                        <span className="font-mono text-xs text-muted-foreground mr-2">{r.reservationNumber}</span>
                        {r.customerName}
                      </span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {fmtCurrency(r.amountTotal / 100)} · {r.bookingDate}
                      </span>
                    </button>
                  ))}
                </div>
                {linkSelectedId && (
                  <p className="text-xs text-success">
                    ✓ Seleccionada reserva #{linkSelectedId}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label>ID numérico del presupuesto</Label>
                <Input
                  className="mt-1"
                  type="number"
                  placeholder="Ej: 1234"
                  value={linkSelectedId ?? ""}
                  onChange={(e) => setLinkSelectedId(e.target.value ? parseInt(e.target.value) : null)}
                />
              </div>
            )}

            <div>
              <Label>Notas (opcional)</Label>
              <Textarea className="mt-1" rows={2} value={linkNotes} onChange={(e) => setLinkNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetLinkModal}>Cancelar</Button>
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
              {linkMut.isPending ? "Vinculando…" : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Incident Modal ── */}
      <Dialog open={incidentId !== null} onOpenChange={(o) => { if (!o) { setIncidentId(null); setIncidentReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar incidencia</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Motivo de la incidencia</Label>
            <Textarea
              className="mt-1"
              rows={3}
              placeholder="Describe el problema..."
              value={incidentReason}
              onChange={(e) => setIncidentReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIncidentId(null); setIncidentReason(""); }}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={!incidentReason.trim() || incidentMut.isPending}
              onClick={() => {
                if (!incidentId || !incidentReason.trim()) return;
                incidentMut.mutate({ id: incidentId, reason: incidentReason.trim() });
              }}
            >
              {incidentMut.isPending ? "Guardando..." : "Confirmar incidencia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Unlink Modal ── */}
      <Dialog open={unlinkId !== null} onOpenChange={(o) => { if (!o) { setUnlinkId(null); setUnlinkNotes(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desvincular operación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">La operación volverá a estado Pendiente y se eliminará la vinculación con la reserva/presupuesto.</p>
            <div>
              <Label>Motivo (opcional)</Label>
              <Textarea className="mt-1" rows={2} value={unlinkNotes} onChange={(e) => setUnlinkNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnlinkId(null); setUnlinkNotes(""); }}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={unlinkMut.isPending}
              onClick={() => {
                if (!unlinkId) return;
                unlinkMut.mutate({ id: unlinkId, notes: unlinkNotes || undefined });
              }}
            >
              {unlinkMut.isPending ? "Desvinculando..." : "Desvincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Import Modal ── */}
      <Dialog open={deleteImportId !== null} onOpenChange={(o) => { if (!o) setDeleteImportId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar importación</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Se eliminarán todas las operaciones de esta importación. Esta acción no se puede deshacer.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteImportId(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={deleteImportMut.isPending}
              onClick={() => {
                if (!deleteImportId) return;
                deleteImportMut.mutate({ id: deleteImportId });
              }}
            >
              {deleteImportMut.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </EconomyShell>
    </AdminLayout>
  );
}
