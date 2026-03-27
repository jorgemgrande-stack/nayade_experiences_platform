/**
 * CuponesManager — Panel Admin: Marketing > Cupones
 * Gestión completa de solicitudes de canje: listado, detalle OCR, incidencias, liquidaciones
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Ticket, Search, Filter, RefreshCw, Eye, CheckCircle,
  AlertTriangle, XCircle, Clock, DollarSign, Zap,
  ChevronLeft, ChevronRight, Download, Plus, Trash2,
  BarChart3, FileText, Settings, ExternalLink, Copy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TabId = "solicitudes" | "incidencias" | "liquidaciones" | "productos";

type StatusOperational = "recibido" | "validado" | "reserva_generada" | "disfrutado" | "incidencia" | "cancelado";
type StatusFinancial = "pendiente_canje_proveedor" | "canjeado_en_proveedor" | "pendiente_cobro" | "cobrado" | "discrepancia";
type OcrStatus = "alta" | "media" | "baja" | "conflicto";

// ─── Helpers visuales ─────────────────────────────────────────────────────────
const STATUS_OP_CONFIG: Record<StatusOperational, { label: string; color: string; icon: React.ElementType }> = {
  recibido:         { label: "Recibido",          color: "bg-sky-500/15 text-sky-300 border-sky-500/25",      icon: Clock },
  validado:         { label: "Validado",           color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", icon: CheckCircle },
  reserva_generada: { label: "Reserva generada",  color: "bg-violet-500/15 text-violet-300 border-violet-500/25", icon: Ticket },
  disfrutado:       { label: "Disfrutado",         color: "bg-green-500/15 text-green-300 border-green-500/25", icon: CheckCircle },
  incidencia:       { label: "Incidencia",         color: "bg-red-500/15 text-red-300 border-red-500/25",     icon: AlertTriangle },
  cancelado:        { label: "Cancelado",          color: "bg-gray-500/15 text-gray-400 border-gray-500/25",  icon: XCircle },
};

const STATUS_FIN_CONFIG: Record<StatusFinancial, { label: string; color: string }> = {
  pendiente_canje_proveedor: { label: "Pdte. canje proveedor", color: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  canjeado_en_proveedor:     { label: "Canjeado en proveedor", color: "bg-sky-500/15 text-sky-300 border-sky-500/25" },
  pendiente_cobro:           { label: "Pdte. cobro",           color: "bg-orange-500/15 text-orange-300 border-orange-500/25" },
  cobrado:                   { label: "Cobrado",               color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" },
  discrepancia:              { label: "Discrepancia",          color: "bg-red-500/15 text-red-300 border-red-500/25" },
};

const OCR_CONFIG: Record<OcrStatus, { label: string; color: string; score: string }> = {
  alta:      { label: "Alta confianza",    color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25", score: "≥90%" },
  media:     { label: "Media confianza",   color: "bg-amber-500/15 text-amber-300 border-amber-500/25",       score: "70-89%" },
  baja:      { label: "Baja confianza",    color: "bg-orange-500/15 text-orange-300 border-orange-500/25",    score: "40-69%" },
  conflicto: { label: "Conflicto",         color: "bg-red-500/15 text-red-300 border-red-500/25",             score: "<40%" },
};

function StatusOpBadge({ status }: { status: StatusOperational }) {
  const cfg = STATUS_OP_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function StatusFinBadge({ status }: { status: StatusFinancial }) {
  const cfg = STATUS_FIN_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function OcrBadge({ status, score }: { status: OcrStatus | null | undefined; score: number | null | undefined }) {
  if (!status) return <span className="text-white/25 text-xs">Sin OCR</span>;
  const cfg = OCR_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${cfg.color}`}>
      {score != null ? `${score}%` : cfg.score}
    </span>
  );
}

// ─── Modal de detalle ─────────────────────────────────────────────────────────
function RedemptionDetailModal({
  id,
  onClose,
  onUpdated,
}: {
  id: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.ticketing.getRedemption.useQuery({ id });
  const updateMutation = trpc.ticketing.updateRedemption.useMutation({
    onSuccess: () => { toast.success("Actualizado correctamente"); onUpdated(); refetch(); },
    onError: () => toast.error("Error al actualizar"),
  });
  const rerunOcr = trpc.ticketing.rerunOcr.useMutation({
    onSuccess: (res) => { toast.success(`OCR completado: ${res.score}% (${res.status})`); refetch(); },
    onError: () => toast.error("Error al ejecutar OCR"),
  });
  const convertMutation = trpc.ticketing.convertToReservation.useMutation({
    onSuccess: (res) => { toast.success(`Reserva #${res.reservationId} creada`); onUpdated(); refetch(); },
    onError: (err) => toast.error(err.message || "Error al convertir"),
  });

  const [editNotes, setEditNotes] = useState<string | null>(null);
  const [editStatusOp, setEditStatusOp] = useState<StatusOperational | "">("");
  const [editStatusFin, setEditStatusFin] = useState<StatusFinancial | "">("");
  const [convertDate, setConvertDate] = useState("");
  const [convertProductId, setConvertProductId] = useState("");
  const [showConvert, setShowConvert] = useState(false);

  const { data: experiencesList } = trpc.public.getExperiences.useQuery(
    { limit: 50 },
    { enabled: showConvert }
  );

  if (isLoading) return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f1a2e] border-white/10 text-white max-w-2xl">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
        </div>
      </DialogContent>
    </Dialog>
  );
  if (!data) return null;

  const handleSave = () => {
    updateMutation.mutate({
      id,
      notes: editNotes !== null ? editNotes : data.notes,
      statusOperational: editStatusOp || undefined,
      statusFinancial: editStatusFin || undefined,
    });
  };

  const handleConvert = () => {
    if (!convertDate || !convertProductId) {
      toast.error("Selecciona fecha y experiencia");
      return;
    }
    convertMutation.mutate({
      id,
      productRealId: parseInt(convertProductId),
      reservationDate: convertDate,
      participants: data.participants ?? 1,
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f1a2e] border-white/10 text-white max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <Ticket className="w-4 h-4 text-amber-400" />
            </div>
            Solicitud #{data.id} — {data.customerName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Alertas */}
          {data.duplicateFlag && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-300 font-medium text-sm">Posible duplicado detectado</p>
                <p className="text-red-400/70 text-xs mt-1">{data.duplicateNotes}</p>
              </div>
            </div>
          )}

          {/* Estados actuales */}
          <div className="flex flex-wrap gap-2">
            <StatusOpBadge status={data.statusOperational as StatusOperational} />
            <StatusFinBadge status={data.statusFinancial as StatusFinancial} />
            <OcrBadge status={data.ocrStatus as OcrStatus | null} score={data.ocrConfidenceScore as number | null | undefined} />
          </div>

          {/* Grid de datos */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <p className="text-white/40 text-xs mb-0.5">Proveedor</p>
                <p className="text-white font-medium">{data.provider}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-0.5">Código cupón</p>
                <div className="flex items-center gap-2">
                  <code className="text-amber-300 font-mono bg-amber-500/10 px-2 py-0.5 rounded">{data.couponCode}</code>
                  <button onClick={() => { navigator.clipboard.writeText(data.couponCode); toast.success("Copiado"); }}
                    className="text-white/30 hover:text-white/60 transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {data.securityCode && (
                <div>
                  <p className="text-white/40 text-xs mb-0.5">Código seguridad</p>
                  <code className="text-sky-300 font-mono bg-sky-500/10 px-2 py-0.5 rounded text-xs">{data.securityCode}</code>
                </div>
              )}
              <div>
                <p className="text-white/40 text-xs mb-0.5">Email</p>
                <p className="text-white">{data.email}</p>
              </div>
              {data.phone && (
                <div>
                  <p className="text-white/40 text-xs mb-0.5">Teléfono</p>
                  <p className="text-white">{data.phone}</p>
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-white/40 text-xs mb-0.5">Fecha solicitada</p>
                <p className="text-white">{data.requestedDate || "—"}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-0.5">Participantes</p>
                <p className="text-white">{data.participants ?? 1} adultos · {data.children ?? 0} niños</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-0.5">Producto ticketing</p>
                <p className="text-white">{data.ticketingProduct?.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs mb-0.5">Recibido</p>
                <p className="text-white">{new Date(data.createdAt).toLocaleString("es-ES")}</p>
              </div>
              {data.reservationId && (
                <div>
                  <p className="text-white/40 text-xs mb-0.5">Reserva vinculada</p>
                  <p className="text-violet-300 font-medium">#{data.reservationId}</p>
                </div>
              )}
            </div>
          </div>

          {/* Adjunto */}
          {data.attachmentUrl && (
            <div>
              <p className="text-white/40 text-xs mb-2">Adjunto del cupón</p>
              <a
                href={data.attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/[0.09] transition-all"
              >
                <FileText className="w-4 h-4 text-amber-400" />
                Ver adjunto
                <ExternalLink className="w-3 h-3 opacity-50" />
              </a>
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 text-sky-400 hover:text-sky-300"
                onClick={() => rerunOcr.mutate({ id })}
                disabled={rerunOcr.isPending}
              >
                {rerunOcr.isPending ? (
                  <div className="w-3.5 h-3.5 border border-sky-400/30 border-t-sky-400 rounded-full animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Re-ejecutar OCR
              </Button>
            </div>
          )}

          {/* OCR Raw Data */}
          {data.ocrRawData != null && (
            <div>
              <p className="text-white/40 text-xs mb-2">Datos extraídos por OCR</p>
              <pre className="bg-black/30 border border-white/[0.06] rounded-xl p-4 text-xs text-white/60 overflow-auto max-h-32">
                {JSON.stringify(data.ocrRawData as Record<string, unknown>, null, 2)}
              </pre>
            </div>
          )}

          {/* Comentarios del cliente */}
          {data.comments && (
            <div>
              <p className="text-white/40 text-xs mb-1">Comentarios del cliente</p>
              <p className="text-white/70 text-sm bg-white/[0.04] rounded-xl p-3 border border-white/[0.06]">{data.comments}</p>
            </div>
          )}

          {/* Actualizar estado */}
          <div className="border-t border-white/[0.08] pt-5 space-y-4">
            <p className="text-white/60 text-xs font-medium uppercase tracking-wider">Actualizar estado</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/40 text-xs mb-1.5 block">Estado operacional</Label>
                <Select value={editStatusOp || data.statusOperational} onValueChange={(v) => setEditStatusOp(v as StatusOperational)}>
                  <SelectTrigger className="bg-white/[0.06] border-white/10 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
                    {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/40 text-xs mb-1.5 block">Estado financiero</Label>
                <Select value={editStatusFin || data.statusFinancial} onValueChange={(v) => setEditStatusFin(v as StatusFinancial)}>
                  <SelectTrigger className="bg-white/[0.06] border-white/10 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
                    {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-white/40 text-xs mb-1.5 block">Notas internas</Label>
              <Textarea
                value={editNotes !== null ? editNotes : (data.notes ?? "")}
                onChange={(e) => setEditNotes(e.target.value)}
                className="bg-white/[0.06] border-white/10 text-white placeholder:text-white/25 text-sm resize-none"
                rows={2}
                placeholder="Notas del equipo…"
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="bg-amber-500 hover:bg-amber-400 text-white h-9 px-6"
            >
              {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>

          {/* Convertir a reserva */}
          {data.statusOperational !== "reserva_generada" && data.statusOperational !== "cancelado" && (
            <div className="border-t border-white/[0.08] pt-5">
              <button
                type="button"
                onClick={() => setShowConvert(!showConvert)}
                className="flex items-center gap-2 text-violet-400 hover:text-violet-300 text-sm font-medium transition-colors"
              >
                <Ticket className="w-4 h-4" />
                {showConvert ? "Cancelar conversión" : "Convertir en reserva real"}
              </button>
              {showConvert && (
                <div className="mt-4 space-y-3 bg-violet-500/5 border border-violet-500/15 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-white/40 text-xs mb-1.5 block">Fecha de reserva</Label>
                      <Input
                        type="date"
                        value={convertDate}
                        onChange={(e) => setConvertDate(e.target.value)}
                        className="bg-white/[0.06] border-white/10 text-white h-9 text-sm [color-scheme:dark]"
                      />
                    </div>
                    <div>
                      <Label className="text-white/40 text-xs mb-1.5 block">Experiencia real</Label>
                      <Select value={convertProductId} onValueChange={setConvertProductId}>
                        <SelectTrigger className="bg-white/[0.06] border-white/10 text-white h-9 text-sm">
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#0f1a2e] border-white/10 text-white max-h-48">
                          {(Array.isArray(experiencesList) ? experiencesList : []).map((e: { id: number; title: string }) => (
                            <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={handleConvert}
                    disabled={convertMutation.isPending}
                    className="bg-violet-600 hover:bg-violet-500 text-white h-9 px-6"
                  >
                    {convertMutation.isPending ? "Creando reserva…" : "Crear reserva"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab: Solicitudes ─────────────────────────────────────────────────────────
function SolicitudesTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterStatusOp, setFilterStatusOp] = useState<StatusOperational | "">("");
  const [filterStatusFin, setFilterStatusFin] = useState<StatusFinancial | "">("");
  const [filterOcr, setFilterOcr] = useState<OcrStatus | "">("");
  const [filterDuplicate, setFilterDuplicate] = useState<boolean | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({
    page,
    pageSize: 20,
    search: search || undefined,
    statusOperational: filterStatusOp || undefined,
    statusFinancial: filterStatusFin || undefined,
    ocrStatus: filterOcr || undefined,
    duplicateFlag: filterDuplicate,
  });

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por nombre, email o código…"
            className="pl-9 bg-white/[0.05] border-white/10 text-white placeholder:text-white/25 h-9 text-sm"
          />
        </div>
        <Select value={filterStatusOp || "all"} onValueChange={(v) => { setFilterStatusOp(v === "all" ? "" : v as StatusOperational); setPage(1); }}>
          <SelectTrigger className="bg-white/[0.05] border-white/10 text-white h-9 text-sm w-44">
            <SelectValue placeholder="Estado operacional" />
          </SelectTrigger>
          <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatusFin || "all"} onValueChange={(v) => { setFilterStatusFin(v === "all" ? "" : v as StatusFinancial); setPage(1); }}>
          <SelectTrigger className="bg-white/[0.05] border-white/10 text-white h-9 text-sm w-44">
            <SelectValue placeholder="Estado financiero" />
          </SelectTrigger>
          <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterOcr || "all"} onValueChange={(v) => { setFilterOcr(v === "all" ? "" : v as OcrStatus); setPage(1); }}>
          <SelectTrigger className="bg-white/[0.05] border-white/10 text-white h-9 text-sm w-36">
            <SelectValue placeholder="OCR" />
          </SelectTrigger>
          <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
            <SelectItem value="all">Todos OCR</SelectItem>
            {Object.entries(OCR_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFilterDuplicate(filterDuplicate === true ? undefined : true)}
          className={`h-9 text-sm border ${filterDuplicate ? "border-red-500/40 text-red-300 bg-red-500/10" : "border-white/10 text-white/50"}`}
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Duplicados
        </Button>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9 text-white/40 hover:text-white">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Tabla */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.08]">
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">ID</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Proveedor</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Código</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Fecha solicitada</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Estado op.</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Estado fin.</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">OCR</th>
                <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Recibido</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.05]">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-white/[0.06] rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-white/30">
                    No hay solicitudes con los filtros aplicados
                  </td>
                </tr>
              ) : (
                data?.items.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors ${item.duplicateFlag ? "bg-red-500/[0.03]" : ""}`}
                  >
                    <td className="px-4 py-3 text-white/50 font-mono text-xs">#{item.id}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-white font-medium">{item.customerName}</p>
                        <p className="text-white/40 text-xs">{item.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white/70">{item.provider}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {item.duplicateFlag && <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />}
                        <code className="text-amber-300 font-mono text-xs">{item.couponCode}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/60 text-xs">{item.requestedDate || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusOpBadge status={item.statusOperational as StatusOperational} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusFinBadge status={item.statusFinancial as StatusFinancial} />
                    </td>
                    <td className="px-4 py-3">
                      <OcrBadge status={item.ocrStatus as OcrStatus | null} score={item.ocrConfidenceScore} />
                    </td>
                    <td className="px-4 py-3 text-white/40 text-xs">
                      {new Date(item.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedId(item.id)}
                        className="h-7 w-7 p-0 text-white/40 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
            <p className="text-white/40 text-xs">{data.total} solicitudes · Página {data.page} de {data.totalPages}</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0 text-white/40">
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="h-7 w-7 p-0 text-white/40">
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <RedemptionDetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onUpdated={() => refetch()}
        />
      )}
    </div>
  );
}

// ─── Tab: Incidencias ─────────────────────────────────────────────────────────
function IncidenciasTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({
    page: 1,
    pageSize: 50,
    statusOperational: "incidencia",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/50 text-sm">Solicitudes con estado <span className="text-red-300 font-medium">Incidencia</span></p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 text-white/40 hover:text-white">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Actualizar
        </Button>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">ID</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Cliente</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Código</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Estado financiero</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Recibido</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" /></td></tr>
            ) : data?.items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/30">No hay incidencias activas</td></tr>
            ) : (
              data?.items.map((item) => (
                <tr key={item.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 text-white/50 font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{item.customerName}</p>
                    <p className="text-white/40 text-xs">{item.email}</p>
                  </td>
                  <td className="px-4 py-3"><code className="text-amber-300 font-mono text-xs">{item.couponCode}</code></td>
                  <td className="px-4 py-3 text-white/60 text-xs">{item.provider}</td>
                  <td className="px-4 py-3"><StatusFinBadge status={item.statusFinancial as StatusFinancial} /></td>
                  <td className="px-4 py-3 text-white/40 text-xs">{new Date(item.createdAt).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedId(item.id)} className="h-7 w-7 p-0 text-white/40 hover:text-white">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <RedemptionDetailModal id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />
      )}
    </div>
  );
}

// ─── Tab: Liquidaciones ───────────────────────────────────────────────────────
function LiquidacionesTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({
    page: 1,
    pageSize: 100,
    statusFinancial: "pendiente_canje_proveedor",
  });

  const pendientes = data?.items ?? [];
  const totalPendiente = pendientes.length;

  return (
    <div className="space-y-4">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pendientes de canje", value: totalPendiente, color: "text-amber-300", icon: Clock },
          { label: "Canjeados en proveedor", value: "—", color: "text-sky-300", icon: CheckCircle },
          { label: "Cobrados", value: "—", color: "text-emerald-300", icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${color}`} />
              <p className="text-white/40 text-xs">{label}</p>
            </div>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-white/50 text-sm">Cupones pendientes de canje con el proveedor</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 text-white/40 hover:text-white">
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Actualizar
        </Button>
      </div>

      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">ID</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Cliente</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Código</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Estado op.</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Importe real</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Recibido</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" /></td></tr>
            ) : pendientes.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/30">No hay cupones pendientes de liquidación</td></tr>
            ) : (
              pendientes.map((item) => (
                <tr key={item.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 text-white/50 font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{item.customerName}</p>
                    <p className="text-white/40 text-xs">{item.email}</p>
                  </td>
                  <td className="px-4 py-3 text-white/60 text-xs">{item.provider}</td>
                  <td className="px-4 py-3"><code className="text-amber-300 font-mono text-xs">{item.couponCode}</code></td>
                  <td className="px-4 py-3"><StatusOpBadge status={item.statusOperational as StatusOperational} /></td>
                  <td className="px-4 py-3 text-white/60 text-xs">{item.realAmount ? `${item.realAmount} €` : "—"}</td>
                  <td className="px-4 py-3 text-white/40 text-xs">{new Date(item.createdAt).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedId(item.id)} className="h-7 w-7 p-0 text-white/40 hover:text-white">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <RedemptionDetailModal id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />
      )}
    </div>
  );
}

// ─── Tab: Productos Ticketing ─────────────────────────────────────────────────
function ProductosTicketingTab() {
  const { data, isLoading, refetch } = trpc.ticketing.listProducts.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", provider: "Groupon", commission: "20.00", rules: "", active: true });

  const createMutation = trpc.ticketing.createProduct.useMutation({
    onSuccess: () => { toast.success("Producto creado"); setShowCreate(false); setForm({ name: "", provider: "Groupon", commission: "20.00", rules: "", active: true }); refetch(); },
    onError: () => toast.error("Error al crear"),
  });
  const updateMutation = trpc.ticketing.updateProduct.useMutation({
    onSuccess: () => { toast.success("Actualizado"); setEditId(null); refetch(); },
    onError: () => toast.error("Error al actualizar"),
  });
  const deleteMutation = trpc.ticketing.deleteProduct.useMutation({
    onSuccess: () => { toast.success("Eliminado"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/50 text-sm">Catálogo de productos ticketing (cupones de proveedores)</p>
        <Button onClick={() => setShowCreate(true)} className="bg-amber-500 hover:bg-amber-400 text-white h-8 px-4 text-sm">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Nuevo producto
        </Button>
      </div>

      {/* Crear */}
      {showCreate && (
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 space-y-4">
          <p className="text-white font-medium text-sm">Nuevo producto ticketing</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-white/40 text-xs mb-1.5 block">Nombre</Label>
              <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="bg-white/[0.06] border-white/10 text-white h-9 text-sm" placeholder="Ej: Cableski 1h Groupon" />
            </div>
            <div>
              <Label className="text-white/40 text-xs mb-1.5 block">Proveedor</Label>
              <Select value={form.provider} onValueChange={(v) => setForm(p => ({ ...p, provider: v }))}>
                <SelectTrigger className="bg-white/[0.06] border-white/10 text-white h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0f1a2e] border-white/10 text-white">
                  {["Groupon", "Wonderbox", "SmartBox", "Otro"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-white/40 text-xs mb-1.5 block">Comisión (%)</Label>
              <Input value={form.commission} onChange={(e) => setForm(p => ({ ...p, commission: e.target.value }))} className="bg-white/[0.06] border-white/10 text-white h-9 text-sm" placeholder="20.00" />
            </div>
            <div>
              <Label className="text-white/40 text-xs mb-1.5 block">Reglas / Condiciones</Label>
              <Input value={form.rules} onChange={(e) => setForm(p => ({ ...p, rules: e.target.value }))} className="bg-white/[0.06] border-white/10 text-white h-9 text-sm" placeholder="Válido temporada 2026…" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => createMutation.mutate(form)} disabled={createMutation.isPending || !form.name} className="bg-amber-500 hover:bg-amber-400 text-white h-8 px-4 text-sm">
              {createMutation.isPending ? "Creando…" : "Crear"}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)} className="h-8 text-white/40">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08]">
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Nombre</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Proveedor</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Comisión</th>
              <th className="text-left px-4 py-3 text-white/40 text-xs font-medium">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin mx-auto" /></td></tr>
            ) : (data ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-white/30">No hay productos ticketing configurados</td></tr>
            ) : (
              (data ?? []).map((prod) => (
                <tr key={prod.id} className="border-b border-white/[0.05] hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{prod.name}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{prod.provider}</td>
                  <td className="px-4 py-3 text-white/60 text-xs">{prod.commission}%</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${prod.active ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" : "bg-gray-500/15 text-gray-400 border-gray-500/25"}`}>
                      {prod.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => updateMutation.mutate({ id: prod.id, active: !prod.active })}
                        className="h-7 px-2 text-white/40 hover:text-white text-xs"
                      >
                        {prod.active ? "Desactivar" : "Activar"}
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => { if (confirm("¿Eliminar este producto?")) deleteMutation.mutate({ id: prod.id }); }}
                        className="h-7 w-7 p-0 text-white/30 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CuponesManager() {
  const [activeTab, setActiveTab] = useState<TabId>("solicitudes");

  const { data: metrics } = trpc.ticketing.getMetrics.useQuery();

  const TABS: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "solicitudes", label: "Solicitudes", icon: Ticket, badge: metrics?.total },
    { id: "incidencias", label: "Incidencias", icon: AlertTriangle, badge: metrics?.incidencias || undefined },
    { id: "liquidaciones", label: "Liquidaciones", icon: DollarSign, badge: metrics?.pendientesCanje || undefined },
    { id: "productos", label: "Productos", icon: Settings },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <Ticket className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="text-white font-heading font-bold text-xl">Cupones & Ticketing</h1>
              <p className="text-white/40 text-sm">Gestión de canjes Groupon, Wonderbox y otros proveedores</p>
            </div>
          </div>
          <a
            href="/canjear-cupon"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-2 text-sm text-white/60 hover:text-white hover:bg-white/[0.09] transition-all"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Ver página pública
          </a>
        </div>

        {/* KPI Cards */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total solicitudes", value: metrics.total, color: "text-white", icon: Ticket },
              { label: "Incidencias activas", value: metrics.incidencias, color: "text-red-300", icon: AlertTriangle },
              { label: "Pdte. canje proveedor", value: metrics.pendientesCanje, color: "text-amber-300", icon: Clock },
              { label: "Cobrados", value: metrics.cobrados, color: "text-emerald-300", icon: CheckCircle },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <p className="text-white/40 text-xs">{label}</p>
                </div>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-white/[0.04] border border-white/[0.08] rounded-xl p-1 w-fit">
          {TABS.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                  : "text-white/40 hover:text-white/70"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {badge != null && badge > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === id ? "bg-amber-500/20" : "bg-white/10"}`}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Contenido del tab */}
        {activeTab === "solicitudes" && <SolicitudesTab />}
        {activeTab === "incidencias" && <IncidenciasTab />}
        {activeTab === "liquidaciones" && <LiquidacionesTab />}
        {activeTab === "productos" && <ProductosTicketingTab />}
      </div>
    </DashboardLayout>
  );
}
