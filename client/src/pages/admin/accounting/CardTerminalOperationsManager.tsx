import { useState, useRef, useEffect } from "react";
import AdminLayout from "@/components/AdminLayout";
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
  RefreshCw,
  Link,
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pendiente:         { label: "Pendiente",       color: "bg-yellow-100 text-yellow-800" },
  conciliado:        { label: "Conciliado",       color: "bg-green-100 text-green-800" },
  incidencia:        { label: "Incidencia",       color: "bg-red-100 text-red-800" },
  ignorado:          { label: "Ignorado",         color: "bg-gray-100 text-gray-600" },
  included_in_batch: { label: "En remesa",        color: "bg-blue-100 text-blue-800" },
  settled:           { label: "Liquidado",        color: "bg-emerald-100 text-emerald-800" },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  VENTA: { label: "Venta", color: "bg-blue-100 text-blue-800" },
  DEVOLUCION: { label: "Devolución", color: "bg-orange-100 text-orange-800" },
  ANULACION: { label: "Anulación", color: "bg-red-100 text-red-800" },
  OTRO: { label: "Otro", color: "bg-gray-100 text-gray-600" },
};

function fmtCurrency(v: string | number | null | undefined): string {
  const n = parseFloat(String(v ?? 0));
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
}

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
  const [linkEntityType, setLinkEntityType] = useState<"reservation" | "quote">("reservation");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkSelectedId, setLinkSelectedId] = useState<number | null>(null);
  const [linkNotes, setLinkNotes] = useState("");

  const resetLinkModal = () => {
    setLinkModalId(null);
    setLinkModalAmount(null);
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
    { search: linkSearch, amountEur: linkModalAmount ?? undefined },
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
      alert(`${data.reset} log(s) reseteado(s). Pulsa "Sincronizar correo TPV" para reprocesar.`);
    },
  });

  const repairStatusMut = trpc.cardTerminalOperations.repairLinkedStatus.useMutation({
    onSuccess: (data) => {
      utils.cardTerminalOperations.list.invalidate();
      alert(`${data.fixed} operación(es) reparada(s) → estado "Conciliado".`);
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
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
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

  return (
    <AdminLayout>
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CreditCard className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Operaciones TPV</h1>
            <p className="text-sm text-muted-foreground">Datafono / Terminal Físico — Comercia Global Payments</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => listQ.refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> Actualizar
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={syncing}
            onClick={() => {
              setSyncing(true);
              setSyncResult(null);
              syncEmailMut.mutate({ retryErrors: false });
            }}
          >
            <Mail className="w-4 h-4 mr-1" />
            {syncing ? "Sincronizando..." : "Sincronizar correo TPV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const date = prompt("Fecha a reprocesar (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
              if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
                resetLogsMut.mutate({ date });
              }
            }}
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Reprocesar fecha
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm("¿Reparar operaciones enlazadas con estado incorrecto? Se pondrán en 'Conciliado'.")) {
                repairStatusMut.mutate();
              }
            }}
          >
            <RefreshCw className="w-4 h-4 mr-1" /> Reparar estados
          </Button>
          <Button size="sm" onClick={() => { setShowImportModal(true); setImportResult(null); }}>
            <Upload className="w-4 h-4 mr-1" /> Importar Excel/PDF
          </Button>
        </div>
      </div>

      {/* Email sync result */}
      {syncResult && (
        <div className={`rounded-lg border p-4 text-sm ${syncResult.errors.length > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
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
            <span>Nuevas: <b className="text-green-700">{syncResult.operationsInserted}</b></span>
            <span>Vinculadas: <b className="text-blue-700">{syncResult.operationsLinked}</b></span>
            <span>Duplicadas: <b>{syncResult.operationsDuplicate}</b></span>
            {syncResult.operationsFailed > 0 && (
              <span>Fallidas: <b className="text-red-700">{syncResult.operationsFailed}</b></span>
            )}
          </div>
          {syncResult.errors.length > 0 && (
            <ul className="mt-2 text-red-700 list-disc list-inside">
              {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Email ingestion logs */}
      <div className="border rounded-lg overflow-hidden">
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
                        <td className="p-2 max-w-[200px] truncate" title={log.subject ?? ""}>{log.subject ?? "-"}</td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            log.status === "ok" ? "bg-green-100 text-green-800"
                            : log.status === "error" ? "bg-red-100 text-red-800"
                            : "bg-gray-100 text-gray-600"
                          }`}>{log.status}</span>
                        </td>
                        <td className="p-2">
                          {log.parsingStrategy ? (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              log.parsingStrategy === "pdf" ? "bg-orange-100 text-orange-700"
                              : log.parsingStrategy === "excel" ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-600"
                            }`}>{log.parsingStrategy}</span>
                          ) : "-"}
                        </td>
                        <td className="p-2 text-right">{log.operationsDetected ?? 0}</td>
                        <td className="p-2 text-right font-medium text-green-700">{log.operationsInserted}</td>
                        <td className="p-2 text-right text-blue-700">{log.operationsLinked ?? 0}</td>
                        <td className="p-2 text-right text-muted-foreground">{log.operationsDuplicate}</td>
                        <td className="p-2 text-right text-red-600">{log.operationsFailed ?? 0}</td>
                        <td className="p-2 text-right text-muted-foreground">{log.retryCount ?? 0}</td>
                        <td className="p-2 text-red-600 max-w-[180px] truncate" title={log.errorMessage ?? ""}>{log.errorMessage ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* KPIs */}
      {listQ.data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Total operaciones</p>
            <p className="text-2xl font-bold">{total}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Total ventas</p>
            <p className="text-2xl font-bold text-green-600">{fmtCurrency(listQ.data.totalVentas)}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Total devoluciones</p>
            <p className="text-2xl font-bold text-orange-600">{fmtCurrency(listQ.data.totalDevoluciones)}</p>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <p className="text-xs text-muted-foreground">Neto</p>
            <p className="text-2xl font-bold">{fmtCurrency(listQ.data.totalVentas - listQ.data.totalDevoluciones)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end bg-muted/30 p-4 rounded-lg">
        <div className="flex-1 min-w-48">
          <Label className="text-xs mb-1 block">Buscar</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9 h-9"
              placeholder="Nº op, tarjeta, terminal..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Estado</Label>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as OpStatus); setPage(1); }}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="conciliado">Conciliado</SelectItem>
              <SelectItem value="incidencia">Incidencia</SelectItem>
              <SelectItem value="ignorado">Ignorado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Tipo</Label>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as OpType); setPage(1); }}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="VENTA">Venta</SelectItem>
              <SelectItem value="DEVOLUCION">Devolución</SelectItem>
              <SelectItem value="ANULACION">Anulación</SelectItem>
              <SelectItem value="OTRO">Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Desde</Label>
          <Input type="date" className="h-9 w-36" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Hasta</Label>
          <Input type="date" className="h-9 w-36" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="w-4 h-4 mr-1" /> Limpiar
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Fecha</th>
              <th className="text-left p-3 font-medium">Nº Operación</th>
              <th className="text-left p-3 font-medium">Terminal</th>
              <th className="text-left p-3 font-medium">Tipo</th>
              <th className="text-right p-3 font-medium">Importe</th>
              <th className="text-left p-3 font-medium">Tarjeta</th>
              <th className="text-left p-3 font-medium">Estado</th>
              <th className="text-left p-3 font-medium">Vinculado a</th>
              <th className="p-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {listQ.isLoading && (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Cargando...</td></tr>
            )}
            {!listQ.isLoading && ops.length === 0 && (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No hay operaciones</td></tr>
            )}
            {ops.map((op) => {
              const statusInfo = STATUS_LABELS[op.status] ?? STATUS_LABELS.pendiente;
              const typeInfo = TYPE_LABELS[op.operationType] ?? TYPE_LABELS.OTRO;
              return (
                <tr key={op.id} className="hover:bg-muted/30">
                  <td className="p-3 whitespace-nowrap">{fmtDatetime(op.operationDatetime)}</td>
                  <td className="p-3 font-mono text-xs">{op.operationNumber || "-"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{op.terminalCode || "-"}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  </td>
                  <td className={`p-3 text-right font-medium ${op.operationType === "DEVOLUCION" ? "text-orange-600" : "text-green-700"}`}>
                    {fmtCurrency(String(op.amount))}
                  </td>
                  <td className="p-3 font-mono text-xs">{op.card ? `****${op.card.slice(-4)}` : "-"}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                  </td>
                  <td className="p-3 text-xs">
                    {op.linkedEntityType && op.linkedEntityType !== "none" ? (
                      op.linkedEntityType === "reservation" ? (
                        <a
                          href={`/admin/crm?tab=reservations&search=${encodeURIComponent((op as any).linkedReservationNumber ?? String(op.linkedEntityId))}`}
                          className="text-sky-400 hover:text-sky-300 hover:underline font-medium"
                        >
                          {(op as any).linkedReservationNumber ?? `#${op.linkedEntityId}`}
                        </a>
                      ) : (
                        <span className="text-amber-400 font-medium">
                          Presupuesto #{op.linkedEntityId}
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1 justify-center">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver detalle" onClick={() => setDetailId(op.id)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {op.status !== "conciliado" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Vincular manualmente" onClick={() => { setLinkModalId(op.id); setLinkModalAmount(parseFloat(op.amount)); }}>
                          <Link className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {op.status === "conciliado" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-orange-600" title="Desvincular" onClick={() => { setUnlinkId(op.id); }}>
                          <Unlink className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {op.status !== "incidencia" && op.status !== "conciliado" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" title="Marcar incidencia" onClick={() => setIncidentId(op.id)}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {op.status === "pendiente" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" title="Ignorar" onClick={() => updateStatusMut.mutate({ id: op.id, status: "ignorado" })}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
            <span className="flex items-center text-sm px-2">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
          </div>
        </div>
      )}

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
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
                <p className="font-semibold text-green-800">Importación completada</p>
                <p className="text-sm text-green-700">{importResult.importedRows} operaciones importadas</p>
                {importResult.duplicatesSkipped > 0 && (
                  <p className="text-sm text-muted-foreground">{importResult.duplicatesSkipped} duplicados omitidos</p>
                )}
                {importResult.autoLinked > 0 && (
                  <p className="text-sm text-blue-700">{importResult.autoLinked} auto-vinculadas a reservas/presupuestos</p>
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
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Fecha</p><p className="font-medium">{fmtDatetime(detailQ.data.operationDatetime)}</p></div>
                <div><p className="text-xs text-muted-foreground">Nº Operación</p><p className="font-mono">{detailQ.data.operationNumber || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Importe</p><p className="font-bold text-lg">{fmtCurrency(String(detailQ.data.amount))}</p></div>
                <div><p className="text-xs text-muted-foreground">Tipo</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_LABELS[detailQ.data.operationType]?.color}`}>
                    {TYPE_LABELS[detailQ.data.operationType]?.label}
                  </span>
                </div>
                <div><p className="text-xs text-muted-foreground">Tarjeta</p><p className="font-mono">{detailQ.data.card ? `****${detailQ.data.card.slice(-4)}` : "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Autorización</p><p className="font-mono">{detailQ.data.authorizationCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Terminal</p><p>{detailQ.data.terminalCode || "-"}</p></div>
                <div><p className="text-xs text-muted-foreground">Comercio</p><p>{detailQ.data.commerceCode || "-"}</p></div>
              </div>
              <hr />
              <div className="grid grid-cols-2 gap-3">
                <div><p className="text-xs text-muted-foreground">Estado</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[detailQ.data.status]?.color}`}>
                    {STATUS_LABELS[detailQ.data.status]?.label}
                  </span>
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
              {detailQ.data.incidentReason && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-xs text-red-600 font-medium mb-1">Motivo incidencia</p>
                  <p className="text-sm">{detailQ.data.incidentReason}</p>
                </div>
              )}
              {detailQ.data.notes && (
                <div><p className="text-xs text-muted-foreground">Notas</p><p>{detailQ.data.notes}</p></div>
              )}
              <div className="flex gap-2 pt-2">
                {detailQ.data.status !== "conciliado" && (
                  <Button size="sm" variant="outline" onClick={() => { setLinkModalId(detailId); setLinkModalAmount(detailQ.data ? parseFloat(detailQ.data.amount) : null); setDetailId(null); }}>
                    <Link className="w-3.5 h-3.5 mr-1" /> Vincular
                  </Button>
                )}
                {detailQ.data.status === "conciliado" && (
                  <Button size="sm" variant="outline" className="text-orange-600" onClick={() => { setUnlinkId(detailId); setDetailId(null); }}>
                    <Unlink className="w-3.5 h-3.5 mr-1" /> Desvincular
                  </Button>
                )}
                {detailQ.data.status !== "incidencia" && detailQ.data.status !== "conciliado" && (
                  <Button size="sm" variant="outline" className="text-red-600" onClick={() => { setIncidentId(detailId); setDetailId(null); }}>
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
                    Mostrando reservas sin vincular con importe {fmtCurrency(linkModalAmount)}
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
                  <p className="text-xs text-green-700">
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
    </AdminLayout>
  );
}
