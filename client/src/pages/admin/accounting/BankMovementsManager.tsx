import { useState, useRef, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  Upload, Trash2, Search, Eye, TrendingUp, TrendingDown,
  FileSpreadsheet, RefreshCw, X, ChevronLeft, ChevronRight,
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
  if (score >= 70) return "text-green-700 bg-green-100";
  if (score >= 40) return "text-yellow-700 bg-yellow-100";
  return "text-gray-600 bg-gray-100";
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-yellow-100 text-yellow-800" },
  ignorado:  { label: "Ignorado",  cls: "bg-gray-100 text-gray-500" },
};

const CONCILIATION_BADGE: Record<string, { label: string; cls: string; icon?: string }> = {
  pendiente:   { label: "Sin conciliar", cls: "bg-orange-100 text-orange-700" },
  conciliado:  { label: "Conciliado",    cls: "bg-green-100 text-green-700" },
};
const EXPENSE_CONCILIATION_BADGE = { label: "Gasto vinculado", cls: "bg-emerald-100 text-emerald-700" };
const MANUAL_CONCILIATION_BADGE  = { label: "Justificado",     cls: "bg-violet-100 text-violet-700" };

const IMPORT_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ok:     { label: "OK",      cls: "bg-green-100 text-green-800" },
  error:  { label: "Error",   cls: "bg-red-100 text-red-800" },
  parcial:{ label: "Parcial", cls: "bg-orange-100 text-orange-800" },
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
    if (!["xls", "xlsx", "csv"].includes(ext)) {
      toast.error("Formato no soportado. Usa .xls, .xlsx o .csv");
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

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Movimientos Bancarios</h1>
            <p className="text-sm text-gray-500 mt-1">Importa, gestiona y concilia los movimientos bancarios de CaixaBank</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {uploading ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Importando...</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" /> Importar fichero</>
              )}
            </Button>
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg"><FileSpreadsheet className="w-5 h-5 text-blue-600" /></div>
                <div>
                  <div className="text-xs text-gray-500">Total movimientos</div>
                  <div className="text-xl font-bold text-gray-900">{totalMovs}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg"><TrendingUp className="w-5 h-5 text-green-600" /></div>
                <div>
                  <div className="text-xs text-gray-500">Total ingresado</div>
                  <div className="text-xl font-bold text-green-700">{fmtAmount(totalIngresado)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg"><TrendingDown className="w-5 h-5 text-red-600" /></div>
                <div>
                  <div className="text-xs text-gray-500">Total cargado</div>
                  <div className="text-xl font-bold text-red-700">{fmtAmount(totalCargado)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200">
          {(["movimientos", "importaciones"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "movimientos" ? "Movimientos" : `Importaciones (${imports.length})`}
            </button>
          ))}
        </div>

        {/* ── TAB: Movimientos ── */}
        {tab === "movimientos" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Buscar movimiento o concepto..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9"
                />
              </div>
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v as any); setPage(1); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="pendiente">Pendiente</SelectItem>
                  <SelectItem value="ignorado">Ignorado</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={filterImportId ? String(filterImportId) : "todos"}
                onValueChange={(v) => { setFilterImportId(v === "todos" ? undefined : Number(v)); setPage(1); }}
              >
                <SelectTrigger className="w-52"><SelectValue placeholder="Todas las importaciones" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas las importaciones</SelectItem>
                  {imports.map((imp) => (
                    <SelectItem key={imp.id} value={String(imp.id)}>{imp.fileName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input type="date" className="w-36" value={filterFechaFrom} onChange={(e) => { setFilterFechaFrom(e.target.value); setPage(1); }} />
              <Input type="date" className="w-36" value={filterFechaTo} onChange={(e) => { setFilterFechaTo(e.target.value); setPage(1); }} />
              {(search || filterStatus !== "todos" || filterImportId || filterFechaFrom || filterFechaTo) && (
                <Button variant="ghost" size="sm" onClick={() => {
                  setSearch(""); setFilterStatus("todos"); setFilterImportId(undefined);
                  setFilterFechaFrom(""); setFilterFechaTo(""); setPage(1);
                }}>
                  <X className="w-4 h-4 mr-1" /> Limpiar
                </Button>
              )}
            </div>

            <div className="rounded-lg border border-white/10 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-white/50 w-28">Fecha</th>
                    <th className="px-4 py-3 text-left font-medium text-white/50 w-28">F. Valor</th>
                    <th className="px-4 py-3 text-left font-medium text-white/50">Movimiento</th>
                    <th className="px-4 py-3 text-left font-medium text-white/50">Más datos</th>
                    <th className="px-4 py-3 text-right font-medium text-white/50 w-32">Importe</th>
                    <th className="px-4 py-3 text-right font-medium text-white/50 w-32">Saldo</th>
                    <th className="px-4 py-3 text-center font-medium text-white/50 w-24">Estado</th>
                    <th className="px-4 py-3 text-center font-medium text-white/50 w-32">Conciliación</th>
                    <th className="px-4 py-3 text-center font-medium text-white/50 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {movementsQ.isLoading ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-white/40">Cargando...</td></tr>
                  ) : movements.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-white/40">No hay movimientos con los filtros seleccionados</td></tr>
                  ) : movements.map((mv) => {
                    const amount = parseFloat(mv.importe);
                    const isPos = amount >= 0;
                    const concBadge = CONCILIATION_BADGE[mv.conciliationStatus ?? "pendiente"];
                    return (
                      <tr
                        key={mv.id}
                        className={`border-b border-white/[0.06] hover:bg-white/[0.04] transition-colors ${mv.status === "ignorado" ? "opacity-40" : ""}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs text-white/80">{fmtDate(mv.fecha)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-white/40">{fmtDate(mv.fechaValor)}</td>
                        <td className="px-4 py-3 text-white/80 max-w-[180px] truncate">{mv.movimiento || "–"}</td>
                        <td className="px-4 py-3 text-white/50 max-w-[200px] truncate text-xs">{mv.masDatos || "–"}</td>
                        <td className={`px-4 py-3 text-right font-semibold font-mono ${isPos ? "text-green-400" : "text-red-400"}`}>
                          {fmtAmount(mv.importe)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-white/40">{fmtAmount(mv.saldo)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={STATUS_BADGE[mv.status].cls}>{STATUS_BADGE[mv.status].label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isPos ? (
                            <Badge className={concBadge.cls}>{concBadge.label}</Badge>
                          ) : mv.conciliationStatus === "conciliado" ? (
                            <Badge className={EXPENSE_CONCILIATION_BADGE.cls}>{EXPENSE_CONCILIATION_BADGE.label}</Badge>
                          ) : (
                            <span className="text-xs text-gray-300">–</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="sm" onClick={() => openDetail(mv)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-gray-600">
                <span>{totalMovs} registros · página {page}/{totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: Importaciones ── */}
        {tab === "importaciones" && (
          <div className="space-y-3">
            {importsQ.isLoading ? (
              <p className="text-gray-400 text-sm">Cargando...</p>
            ) : imports.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>No hay importaciones todavía</p>
                <p className="text-xs mt-1">Usa el botón "Importar fichero" para cargar un extracto de CaixaBank</p>
              </div>
            ) : (
              <div className="rounded-lg border border-white/10 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-white/50">Fichero</th>
                      <th className="px-4 py-3 text-center font-medium text-white/50 w-20">Tipo</th>
                      <th className="px-4 py-3 text-center font-medium text-white/50 w-28">Importados</th>
                      <th className="px-4 py-3 text-center font-medium text-white/50 w-28">Duplicados</th>
                      <th className="px-4 py-3 text-center font-medium text-white/50 w-24">Estado</th>
                      <th className="px-4 py-3 text-left font-medium text-white/50 w-40">Fecha</th>
                      <th className="px-4 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((imp) => (
                      <tr key={imp.id} className="border-b border-white/[0.06] hover:bg-white/[0.04]">
                        <td className="px-4 py-3 font-medium text-white/80">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-green-400" />
                            {imp.fileName}
                          </div>
                          {imp.errorMessage && (
                            <div className="text-xs text-red-400 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> {imp.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs uppercase text-white/40">{imp.fileType}</td>
                        <td className="px-4 py-3 text-center font-semibold text-blue-400">{imp.importedRows}</td>
                        <td className="px-4 py-3 text-center text-white/50">{imp.duplicatesSkipped}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={IMPORT_STATUS_BADGE[imp.status].cls}>{IMPORT_STATUS_BADGE[imp.status].label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-white/40">{new Date(imp.createdAt).toLocaleString("es-ES")}</td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            variant="ghost" size="sm"
                            className="text-red-500 hover:text-red-700"
                            onClick={() => {
                              if (!confirm(`¿Eliminar importación "${imp.fileName}" y todos sus movimientos?`)) return;
                              deleteImportMut.mutate({ id: imp.id });
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Fecha</div>
                  <div className="font-medium">{fmtDate(selectedMovement.fecha)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-1">Fecha valor</div>
                  <div className="font-medium">{fmtDate(selectedMovement.fechaValor)}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-xs text-gray-500 mb-1">Movimiento</div>
                  <div className="font-medium">{selectedMovement.movimiento || "–"}</div>
                </div>
                {selectedMovement.masDatos && (
                  <div className="col-span-2">
                    <div className="text-xs text-gray-500 mb-1">Más datos</div>
                    <div className="text-gray-700 text-xs break-words">{selectedMovement.masDatos}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-gray-500 mb-1">Importe</div>
                  <div className={`text-lg font-bold ${parseFloat(selectedMovement.importe) >= 0 ? "text-green-700" : "text-red-700"}`}>
                    {fmtAmount(selectedMovement.importe)}
                  </div>
                </div>
                {selectedMovement.saldo && (
                  <div>
                    <div className="text-xs text-gray-500 mb-1">Saldo</div>
                    <div className="font-medium">{fmtAmount(selectedMovement.saldo)}</div>
                  </div>
                )}
              </div>

              <hr />

              {/* ── Sección conciliación (solo ingresos) ── */}
              {isPositive && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-blue-500" />
                      Conciliación bancaria
                    </h3>
                    {isConciliated ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
                        onClick={() => setUnlinkConfirm(true)}
                      >
                        <Link2Off className="w-3.5 h-3.5 mr-1" /> Desvincular
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-blue-600 border-blue-200 hover:bg-blue-50 text-xs"
                        onClick={() => setShowMatches(!showMatches)}
                      >
                        <Sparkles className="w-3.5 h-3.5 mr-1" />
                        {showMatches ? "Ocultar propuestas" : "Buscar coincidencias"}
                      </Button>
                    )}
                  </div>

                  {/* Vínculo confirmado */}
                  {isConciliated && confirmedLink && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                      <div className="flex items-center gap-2 text-green-800 font-medium mb-2">
                        <CheckCircle className="w-4 h-4" /> Conciliado con presupuesto
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-green-700">
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
                        <div className="text-sm text-gray-400 text-center py-4">
                          <RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Buscando coincidencias...
                        </div>
                      ) : matches.length === 0 ? (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
                          <Info className="w-4 h-4 inline mr-1" />
                          No se encontraron presupuestos pendientes que coincidan con este ingreso.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-gray-500">
                            {matches.length} presupuesto{matches.length > 1 ? "s" : ""} posible{matches.length > 1 ? "s" : ""} encontrado{matches.length > 1 ? "s" : ""}
                          </p>
                          {matches.map((m) => (
                            <div
                              key={m.quoteId}
                              className={`rounded-lg border p-3 text-sm space-y-2 ${m.isRejected ? "opacity-50 border-gray-200 bg-gray-50" : "border-blue-100 bg-blue-50/50"}`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-gray-800">{m.quoteNumber} — {m.title}</div>
                                  <div className="text-xs text-gray-500">
                                    {m.clientName && <span>{m.clientName} · </span>}
                                    {m.clientEmail && <span>{m.clientEmail} · </span>}
                                    Total: <span className="font-medium text-gray-700">{fmtAmount(m.total)}</span>
                                  </div>
                                  {m.sentAt && (
                                    <div className="text-xs text-gray-400">Enviado: {fmtDate(m.sentAt)}</div>
                                  )}
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${scoreColor(m.confidenceScore)}`}>
                                    {m.confidenceScore}% coincidencia
                                  </span>
                                  {m.isRejected && <span className="text-xs text-gray-400">Rechazado</span>}
                                </div>
                              </div>

                              {confirmingQuoteId === m.quoteId ? (
                                <div className="rounded-md border border-orange-200 bg-orange-50 p-3 space-y-2">
                                  <p className="text-xs text-orange-800 font-medium">
                                    ¿Confirmar conciliación?
                                  </p>
                                  <p className="text-xs text-orange-700">
                                    Este movimiento del {fmtDate(selectedMovement.fecha)} por {fmtAmount(selectedMovement.importe)} quedará vinculado
                                    al presupuesto <strong>{m.quoteNumber}</strong> y se generará la reserva y factura correspondiente.
                                  </p>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      className="bg-green-600 hover:bg-green-700 text-white text-xs"
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
                                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
                                  <p className="text-xs text-gray-700">¿Rechazar esta propuesta? No se modificará nada.</p>
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="text-xs border-red-200 text-red-600 hover:bg-red-50"
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
                                    className="bg-green-600 hover:bg-green-700 text-white text-xs"
                                    onClick={() => setConfirmingQuoteId(m.quoteId)}
                                  >
                                    <CheckCircle className="w-3 h-3 mr-1" /> Aceptar conciliación
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs text-gray-500"
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
                      <summary className="cursor-pointer text-gray-400 hover:text-gray-600">Ver historial de vínculos ({(linksQ.data as unknown as BankMovementLink[]).length})</summary>
                      <div className="mt-2 space-y-1 pl-2 border-l-2 border-gray-100">
                        {(linksQ.data as unknown as BankMovementLink[]).map(l => (
                          <div key={l.id} className="text-gray-500">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-xs mr-1 ${
                              l.status === "confirmed" ? "bg-green-100 text-green-700" :
                              l.status === "rejected" ? "bg-red-100 text-red-600" :
                              l.status === "unlinked" ? "bg-gray-100 text-gray-500" :
                              "bg-blue-100 text-blue-600"
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
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-violet-500" />
                      Conciliación manual
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-violet-600 border-violet-200 hover:bg-violet-50 text-xs"
                      onClick={() => setShowManualForm(!showManualForm)}
                    >
                      {showManualForm ? "Cancelar" : "Justificar manualmente"}
                    </Button>
                  </div>
                  {showManualForm && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-3">
                      <p className="text-xs text-violet-700">
                        Usa esto cuando el movimiento no corresponde a ninguna operación del sistema (transferencias internas, cuotas bancarias, impuestos, etc.).
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600 font-medium">Tipo de movimiento *</label>
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
                        <label className="text-xs text-gray-600 font-medium">Contraparte</label>
                        <Input
                          className="text-sm"
                          value={manualCounterparty}
                          onChange={(e) => setManualCounterparty(e.target.value)}
                          placeholder="Ej: CaixaBank, NEXTAIR S.L., Agencia Tributaria…"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-gray-600 font-medium">Justificación *</label>
                        <textarea
                          className="w-full text-sm border border-violet-200 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
                          rows={2}
                          value={manualNotes}
                          onChange={(e) => setManualNotes(e.target.value)}
                          placeholder="Describe brevemente el motivo de este movimiento…"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="bg-violet-600 hover:bg-violet-700 text-white text-xs w-full"
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
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-violet-500" />
                      Conciliación manual
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
                      onClick={() => setUnlinkConfirm(true)}
                    >
                      <Link2Off className="w-3.5 h-3.5 mr-1" /> Desvincular
                    </Button>
                  </div>
                  <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                    <div className="flex items-center gap-2 text-violet-800 font-medium mb-1">
                      <CheckCircle className="w-4 h-4" /> Justificado manualmente
                    </div>
                    <p className="text-xs text-violet-700">{confirmedLink.notes ?? "—"}</p>
                    <div className="text-xs text-violet-500 mt-1">
                      Por {confirmedLink.matchedBy ?? "–"} · {confirmedLink.matchedAt ? fmtDate(confirmedLink.matchedAt) : "–"}
                    </div>
                  </div>
                </div>
              )}

              <hr />

              {/* Estado y notas */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Estado</label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as "pendiente" | "ignorado")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-yellow-500" /> Pendiente</span>
                      </SelectItem>
                      <SelectItem value="ignorado">
                        <span className="flex items-center gap-2"><MinusCircle className="w-4 h-4 text-gray-400" /> Ignorado</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Notas internas</label>
                  <textarea
                    className="w-full text-sm border border-gray-200 rounded-md p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                    rows={3}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notas opcionales sobre este movimiento..."
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setSelectedMovement(null)}>Cancelar</Button>
                <Button onClick={saveDetail} disabled={savingDetail} className="bg-blue-600 hover:bg-blue-700 text-white">
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
          <p className="text-sm text-gray-600">
            Se romperá el vínculo contable entre este movimiento bancario y el presupuesto asociado.
            <strong> La reserva y la factura no se modificarán.</strong>
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUnlinkConfirm(false)}>Cancelar</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
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
