import { useState, useRef, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  CheckCircle, MinusCircle, AlertCircle,
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

function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  return d;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendiente: { label: "Pendiente", cls: "bg-yellow-100 text-yellow-800" },
  ignorado:  { label: "Ignorado",  cls: "bg-gray-100 text-gray-500" },
};

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

  // ── Detail modal open ──────────────────────────────────────────────────────

  const openDetail = (mv: BankMovement) => {
    setSelectedMovement(mv);
    setEditNotes(mv.notes ?? "");
    setEditStatus(mv.status);
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

  return (
    <AdminLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Movimientos Bancarios</h1>
            <p className="text-sm text-gray-500 mt-1">Importa y gestiona el histórico de movimientos de cuenta CaixaBank</p>
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".xls,.xlsx,.csv"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <FileSpreadsheet className="w-5 h-5 text-blue-600" />
                </div>
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
                <div className="p-2 bg-green-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
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
                <div className="p-2 bg-red-100 rounded-lg">
                  <TrendingDown className="w-5 h-5 text-red-600" />
                </div>
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
                tab === t
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "movimientos" ? "Movimientos" : `Importaciones (${imports.length})`}
            </button>
          ))}
        </div>

        {/* ── TAB: Movimientos ── */}
        {tab === "movimientos" && (
          <div className="space-y-4">
            {/* Filters */}
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
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v as "todos" | "pendiente" | "ignorado"); setPage(1); }}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
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
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Todas las importaciones" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas las importaciones</SelectItem>
                  {imports.map((imp) => (
                    <SelectItem key={imp.id} value={String(imp.id)}>
                      {imp.fileName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                className="w-36"
                value={filterFechaFrom}
                onChange={(e) => { setFilterFechaFrom(e.target.value); setPage(1); }}
                placeholder="Desde"
              />
              <Input
                type="date"
                className="w-36"
                value={filterFechaTo}
                onChange={(e) => { setFilterFechaTo(e.target.value); setPage(1); }}
                placeholder="Hasta"
              />
              {(search || filterStatus !== "todos" || filterImportId || filterFechaFrom || filterFechaTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch(""); setFilterStatus("todos");
                    setFilterImportId(undefined); setFilterFechaFrom(""); setFilterFechaTo(""); setPage(1);
                  }}
                >
                  <X className="w-4 h-4 mr-1" /> Limpiar
                </Button>
              )}
            </div>

            {/* Table */}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 w-28">Fecha</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 w-28">F. Valor</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Movimiento</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Más datos</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 w-32">Importe</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600 w-32">Saldo</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600 w-28">Estado</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {movementsQ.isLoading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td></tr>
                  ) : movements.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No hay movimientos con los filtros seleccionados</td></tr>
                  ) : movements.map((mv) => {
                    const amount = parseFloat(mv.importe);
                    const isPos = amount >= 0;
                    return (
                      <tr
                        key={mv.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${mv.status === "ignorado" ? "opacity-50" : ""}`}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{fmtDate(mv.fecha)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{fmtDate(mv.fechaValor)}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">{mv.movimiento || "–"}</td>
                        <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate text-xs">{mv.masDatos || "–"}</td>
                        <td className={`px-4 py-3 text-right font-semibold font-mono ${isPos ? "text-green-700" : "text-red-700"}`}>
                          {fmtAmount(mv.importe)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-500">{fmtAmount(mv.saldo)}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={STATUS_BADGE[mv.status].cls}>
                            {STATUS_BADGE[mv.status].label}
                          </Badge>
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

            {/* Pagination */}
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
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Fichero</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 w-20">Tipo</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 w-28">Importados</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 w-28">Duplicados</th>
                      <th className="px-4 py-3 text-center font-medium text-gray-600 w-24">Estado</th>
                      <th className="px-4 py-3 text-left font-medium text-gray-600 w-40">Fecha</th>
                      <th className="px-4 py-3 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((imp) => (
                      <tr key={imp.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4 text-green-600" />
                            {imp.fileName}
                          </div>
                          {imp.errorMessage && (
                            <div className="text-xs text-red-500 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" /> {imp.errorMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-xs uppercase text-gray-500">{imp.fileType}</td>
                        <td className="px-4 py-3 text-center font-semibold text-blue-700">{imp.importedRows}</td>
                        <td className="px-4 py-3 text-center text-gray-500">{imp.duplicatesSkipped}</td>
                        <td className="px-4 py-3 text-center">
                          <Badge className={IMPORT_STATUS_BADGE[imp.status].cls}>
                            {IMPORT_STATUS_BADGE[imp.status].label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {new Date(imp.createdAt).toLocaleString("es-ES")}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalle del movimiento</DialogTitle>
          </DialogHeader>
          {selectedMovement && (
            <div className="space-y-4">
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

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Estado</label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v as "pendiente" | "ignorado")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pendiente">
                        <span className="flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-yellow-500" /> Pendiente
                        </span>
                      </SelectItem>
                      <SelectItem value="ignorado">
                        <span className="flex items-center gap-2">
                          <MinusCircle className="w-4 h-4 text-gray-400" /> Ignorado
                        </span>
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
                <Button variant="outline" onClick={() => setSelectedMovement(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={saveDetail}
                  disabled={savingDetail}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {savingDetail ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
