/**
 * CuponesManager — Panel Admin: Marketing > Cupones & Ticketing
 * Estilo: mismo look & feel que CRM y Contabilidad (tema claro del dashboard)
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Ticket, Search, RefreshCw, Eye, CheckCircle,
  AlertTriangle, XCircle, Clock, DollarSign,
  ChevronLeft, ChevronRight, Plus, Trash2,
  Settings, ExternalLink, Copy, TrendingUp, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TabId = "solicitudes" | "incidencias" | "liquidaciones" | "productos";
type StatusOperational = "recibido" | "validado" | "reserva_generada" | "disfrutado" | "incidencia" | "cancelado";
type StatusFinancial = "pendiente_canje_proveedor" | "canjeado_en_proveedor" | "pendiente_cobro" | "cobrado" | "discrepancia";
type OcrStatus = "alta" | "media" | "baja" | "conflicto";

// ─── Helpers visuales ─────────────────────────────────────────────────────────
const STATUS_OP_CONFIG: Record<StatusOperational, { label: string; className: string; icon: React.ElementType }> = {
  recibido:         { label: "Recibido",         className: "bg-blue-100 text-blue-700",       icon: Clock },
  validado:         { label: "Validado",          className: "bg-emerald-100 text-emerald-700", icon: CheckCircle },
  reserva_generada: { label: "Reserva generada", className: "bg-violet-100 text-violet-700",   icon: Ticket },
  disfrutado:       { label: "Disfrutado",        className: "bg-green-100 text-green-700",     icon: CheckCircle },
  incidencia:       { label: "Incidencia",        className: "bg-red-100 text-red-700",         icon: AlertTriangle },
  cancelado:        { label: "Cancelado",         className: "bg-gray-100 text-gray-600",       icon: XCircle },
};
const STATUS_FIN_CONFIG: Record<StatusFinancial, { label: string; className: string }> = {
  pendiente_canje_proveedor: { label: "Pdte. canje prov.",  className: "bg-amber-100 text-amber-700" },
  canjeado_en_proveedor:     { label: "Canjeado en prov.",  className: "bg-sky-100 text-sky-700" },
  pendiente_cobro:           { label: "Pdte. cobro",        className: "bg-orange-100 text-orange-700" },
  cobrado:                   { label: "Cobrado",            className: "bg-emerald-100 text-emerald-700" },
  discrepancia:              { label: "Discrepancia",       className: "bg-red-100 text-red-700" },
};
const OCR_CONFIG: Record<OcrStatus, { label: string; className: string; score: string }> = {
  alta:      { label: "Alta",      className: "bg-emerald-100 text-emerald-700", score: ">=90%" },
  media:     { label: "Media",     className: "bg-amber-100 text-amber-700",     score: "70-89%" },
  baja:      { label: "Baja",      className: "bg-orange-100 text-orange-700",   score: "40-69%" },
  conflicto: { label: "Conflicto", className: "bg-red-100 text-red-700",         score: "<40%" },
};

function StatusOpBadge({ status }: { status: StatusOperational }) {
  const cfg = STATUS_OP_CONFIG[status] ?? STATUS_OP_CONFIG.recibido;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
function StatusFinBadge({ status }: { status: StatusFinancial }) {
  const cfg = STATUS_FIN_CONFIG[status] ?? STATUS_FIN_CONFIG.pendiente_canje_proveedor;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}
function OcrBadge({ status, score }: { status: OcrStatus | null | undefined; score?: number | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">Sin OCR</span>;
  const cfg = OCR_CONFIG[status] ?? OCR_CONFIG.baja;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      {score != null ? `${score}%` : cfg.score}
    </span>
  );
}

// ─── Modal de detalle ─────────────────────────────────────────────────────────
function RedemptionDetailModal({ id, onClose, onUpdated }: { id: number; onClose: () => void; onUpdated: () => void }) {
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
  const { data: experiencesList } = trpc.public.getExperiences.useQuery({ limit: 50 }, { enabled: showConvert });

  if (isLoading) return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      </DialogContent>
    </Dialog>
  );
  if (!data) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center">
              <Ticket className="w-4 h-4 text-amber-600" />
            </div>
            Solicitud #{data.id} — {data.customerName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {data.duplicateFlag && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700 font-medium text-sm">Posible duplicado detectado</p>
                <p className="text-red-500 text-xs mt-1">{data.duplicateNotes}</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <StatusOpBadge status={data.statusOperational as StatusOperational} />
            <StatusFinBadge status={data.statusFinancial as StatusFinancial} />
            <OcrBadge status={data.ocrStatus as OcrStatus | null} score={data.ocrConfidenceScore as number | null} />
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div><p className="text-muted-foreground text-xs mb-0.5">Proveedor</p><p className="text-foreground font-medium">{data.provider}</p></div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Código cupón</p>
                <div className="flex items-center gap-2">
                  <code className="text-amber-600 font-mono bg-amber-50 px-2 py-0.5 rounded border border-amber-200 text-xs">{data.couponCode}</code>
                  <button onClick={() => { navigator.clipboard.writeText(data.couponCode); toast.success("Copiado"); }} className="text-muted-foreground hover:text-foreground transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {data.securityCode && <div><p className="text-muted-foreground text-xs mb-0.5">Código seguridad</p><code className="text-foreground font-mono text-xs">{data.securityCode}</code></div>}
              <div><p className="text-muted-foreground text-xs mb-0.5">Email</p><p className="text-foreground">{data.email}</p></div>
              {data.phone && <div><p className="text-muted-foreground text-xs mb-0.5">Teléfono</p><p className="text-foreground">{data.phone}</p></div>}
            </div>
            <div className="space-y-3">
              <div><p className="text-muted-foreground text-xs mb-0.5">Fecha solicitada</p><p className="text-foreground">{data.requestedDate || "—"}</p></div>
              <div><p className="text-muted-foreground text-xs mb-0.5">Participantes</p><p className="text-foreground">{data.participants ?? 1} adultos · {data.children ?? 0} niños</p></div>
              <div><p className="text-muted-foreground text-xs mb-0.5">Producto ticketing</p><p className="text-foreground">{data.ticketingProduct?.name ?? "—"}</p></div>
              <div><p className="text-muted-foreground text-xs mb-0.5">Recibido</p><p className="text-foreground">{new Date(data.createdAt).toLocaleString("es-ES")}</p></div>
              {data.reservationId && <div><p className="text-muted-foreground text-xs mb-0.5">Reserva vinculada</p><span className="text-blue-600 font-medium">#{data.reservationId}</span></div>}
            </div>
          </div>
        {data.attachmentUrl && (
            <div>
              <p className="text-muted-foreground text-xs mb-2">Adjunto del cupón</p>
              <a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
                <ExternalLink className="w-3.5 h-3.5" />Ver cupón adjunto
              </a>
            </div>
           )}

          {data.ocrRawData != null && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-muted-foreground text-xs">Datos extraídos por OCR</p>
                <Button variant="outline" size="sm" onClick={() => rerunOcr.mutate({ id })} disabled={rerunOcr.isPending || !data.attachmentUrl} className="h-7 text-xs">
                  <Zap className="w-3 h-3 mr-1" />{rerunOcr.isPending ? "Procesando…" : "Re-ejecutar OCR"}
                </Button>
              </div>
              <pre className="bg-muted border border-border rounded-xl p-4 text-xs text-muted-foreground overflow-auto max-h-32">
                {String(typeof data.ocrRawData === "string" ? data.ocrRawData : JSON.stringify(data.ocrRawData, null, 2))}
              </pre>
            </div>
          )}
          {data.comments && (
            <div>
              <p className="text-muted-foreground text-xs mb-1">Comentarios del cliente</p>
              <p className="text-foreground text-sm bg-muted rounded-xl p-3 border border-border">{data.comments}</p>
            </div>
          )}
          <div className="border-t border-border pt-5 space-y-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actualizar estado</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-muted-foreground text-xs mb-1.5 block">Estado operacional</Label>
                <Select value={editStatusOp || "keep"} onValueChange={(v) => setEditStatusOp(v === "keep" ? "" : v as StatusOperational)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin cambio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Sin cambio</SelectItem>
                    {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-muted-foreground text-xs mb-1.5 block">Estado financiero</Label>
                <Select value={editStatusFin || "keep"} onValueChange={(v) => setEditStatusFin(v === "keep" ? "" : v as StatusFinancial)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Sin cambio" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">Sin cambio</SelectItem>
                    {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-muted-foreground text-xs mb-1.5 block">Notas internas</Label>
              <Textarea value={editNotes !== null ? editNotes : (data.notes ?? "")} onChange={(e) => setEditNotes(e.target.value)} className="text-sm resize-none" rows={2} placeholder="Notas del equipo…" />
            </div>
            <Button onClick={() => updateMutation.mutate({ id, notes: editNotes !== null ? editNotes : data.notes, statusOperational: editStatusOp || undefined, statusFinancial: editStatusFin || undefined })} disabled={updateMutation.isPending} className="h-9 px-6">
              {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
          {data.statusOperational !== "reserva_generada" && data.statusOperational !== "cancelado" && (
            <div className="border-t border-border pt-5">
              <button type="button" onClick={() => setShowConvert(!showConvert)} className="flex items-center gap-2 text-violet-600 hover:text-violet-700 text-sm font-medium transition-colors">
                <Ticket className="w-4 h-4" />{showConvert ? "Cancelar conversión" : "Convertir en reserva real"}
              </button>
              {showConvert && (
                <div className="mt-4 space-y-3 bg-violet-50 border border-violet-200 rounded-xl p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-muted-foreground text-xs mb-1.5 block">Fecha de reserva</Label>
                      <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs mb-1.5 block">Experiencia real</Label>
                      <Select value={convertProductId} onValueChange={setConvertProductId}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                        <SelectContent className="max-h-48">
                          {(Array.isArray(experiencesList) ? experiencesList : []).map((e: { id: number; title: string }) => (
                            <SelectItem key={e.id} value={String(e.id)}>{e.title}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      if (!convertDate || !convertProductId) { toast.error("Selecciona fecha y experiencia"); return; }
                      convertMutation.mutate({ id, productRealId: parseInt(convertProductId), reservationDate: convertDate, participants: data.participants ?? 1 });
                    }}
                    disabled={convertMutation.isPending}
                    className="bg-violet-600 hover:bg-violet-700 text-white h-9 px-6"
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
  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({
    page, pageSize: 20,
    search: search || undefined,
    statusOperational: filterStatusOp || undefined,
    statusFinancial: filterStatusFin || undefined,
    ocrStatus: filterOcr || undefined,
    duplicateFlag: filterDuplicate,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar por nombre, email o código…" className="pl-9 h-9 text-sm" />
        </div>
        <Select value={filterStatusOp || "all"} onValueChange={(v) => { setFilterStatusOp(v === "all" ? "" : v as StatusOperational); setPage(1); }}>
          <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Estado operacional" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatusFin || "all"} onValueChange={(v) => { setFilterStatusFin(v === "all" ? "" : v as StatusFinancial); setPage(1); }}>
          <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Estado financiero" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterOcr || "all"} onValueChange={(v) => { setFilterOcr(v === "all" ? "" : v as OcrStatus); setPage(1); }}>
          <SelectTrigger className="h-9 text-sm w-36"><SelectValue placeholder="OCR" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos OCR</SelectItem>
            {Object.entries(OCR_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setFilterDuplicate(filterDuplicate === true ? undefined : true)} className={cn("h-9 text-sm", filterDuplicate && "border-red-300 text-red-600 bg-red-50")}>
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />Duplicados
        </Button>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["ID","Cliente","Proveedor","Código","Fecha sol.","Estado op.","Estado fin.","OCR","Recibido",""].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 10 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : data?.items.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">No hay solicitudes con los filtros aplicados</td></tr>
              ) : (
                data?.items.map((item) => (
                  <tr key={item.id} className={cn("border-b border-border hover:bg-muted/30 transition-colors", item.duplicateFlag && "bg-red-50/50")}>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                    <td className="px-4 py-3"><p className="text-foreground font-medium">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
                    <td className="px-4 py-3 text-foreground text-sm">{item.provider}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {item.duplicateFlag && <AlertTriangle className="w-3 h-3 text-red-500 shrink-0" />}
                        <code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{item.couponCode}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{item.requestedDate || "—"}</td>
                    <td className="px-4 py-3"><StatusOpBadge status={item.statusOperational as StatusOperational} /></td>
                    <td className="px-4 py-3"><StatusFinBadge status={item.statusFinancial as StatusFinancial} /></td>
                    <td className="px-4 py-3"><OcrBadge status={item.ocrStatus as OcrStatus | null} score={item.ocrConfidenceScore} /></td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(item.createdAt).toLocaleDateString("es-ES")}</td>
                    <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => setSelectedId(item.id)} className="h-7 w-7 p-0"><Eye className="w-3.5 h-3.5" /></Button></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <p className="text-muted-foreground text-xs">{data.total} solicitudes · Página {data.page} de {data.totalPages}</p>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0"><ChevronLeft className="w-3.5 h-3.5" /></Button>
              <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="h-7 w-7 p-0"><ChevronRight className="w-3.5 h-3.5" /></Button>
            </div>
          </div>
        )}
      </div>
      {selectedId && <RedemptionDetailModal id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />}
    </div>
  );
}

// ─── Tab: Incidencias ─────────────────────────────────────────────────────────
function IncidenciasTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({ page: 1, pageSize: 50, statusOperational: "incidencia" });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Solicitudes con estado <span className="text-red-600 font-medium">Incidencia</span></p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Actualizar</Button>
      </div>
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["ID","Cliente","Código","Proveedor","Estado financiero","Recibido",""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : data?.items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">No hay incidencias activas</td></tr>
            ) : (
              data?.items.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
                  <td className="px-4 py-3"><code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{item.couponCode}</code></td>
                  <td className="px-4 py-3 text-foreground text-sm">{item.provider}</td>
                  <td className="px-4 py-3"><StatusFinBadge status={item.statusFinancial as StatusFinancial} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(item.createdAt).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => setSelectedId(item.id)} className="h-7 w-7 p-0"><Eye className="w-3.5 h-3.5" /></Button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {selectedId && <RedemptionDetailModal id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />}
    </div>
  );
}

// ─── Tab: Liquidaciones ───────────────────────────────────────────────────────
function LiquidacionesTab() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = trpc.ticketing.listRedemptions.useQuery({ page: 1, pageSize: 100, statusFinancial: "pendiente_canje_proveedor" });
  const pendientes = data?.items ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pendientes de canje", value: pendientes.length, color: "text-amber-600", bg: "bg-amber-50", icon: Clock },
          { label: "Canjeados en proveedor", value: "—", color: "text-sky-600", bg: "bg-sky-50", icon: CheckCircle },
          { label: "Cobrados", value: "—", color: "text-emerald-600", bg: "bg-emerald-50", icon: DollarSign },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-card rounded-2xl border border-border/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bg)}><Icon className={cn("w-4 h-4", color)} /></div>
              <p className="text-muted-foreground text-xs">{label}</p>
            </div>
            <p className={cn("text-2xl font-bold", color)}>{value}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Cupones pendientes de canje con el proveedor</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8"><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Actualizar</Button>
      </div>
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["ID","Cliente","Código","Proveedor","Fecha sol.",""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : pendientes.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No hay cupones pendientes de liquidar</td></tr>
            ) : (
              pendientes.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
                  <td className="px-4 py-3"><code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{item.couponCode}</code></td>
                  <td className="px-4 py-3 text-foreground text-sm">{item.provider}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{item.requestedDate || "—"}</td>
                  <td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => setSelectedId(item.id)} className="h-7 w-7 p-0"><Eye className="w-3.5 h-3.5" /></Button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {selectedId && <RedemptionDetailModal id={selectedId} onClose={() => setSelectedId(null)} onUpdated={() => refetch()} />}
    </div>
  );
}

// ─── Tab: Productos Ticketing ─────────────────────────────────────────────────
function ProductosTicketingTab() {
  const { data: products, isLoading, refetch } = trpc.ticketing.listProducts.useQuery();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProvider, setNewProvider] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newDesc, setNewDesc] = useState("");
  // newDesc maps to 'rules' field (description/notes about the product)
  const createMutation = trpc.ticketing.createProduct.useMutation({
    onSuccess: () => { toast.success("Producto creado"); setShowCreate(false); setNewName(""); setNewProvider(""); setNewPrice(""); setNewDesc(""); refetch(); },
    onError: () => toast.error("Error al crear el producto"),
  });
  const toggleMutation = trpc.ticketing.updateProduct.useMutation({ onSuccess: () => refetch(), onError: () => toast.error("Error") });
  const deleteMutation = trpc.ticketing.deleteProduct.useMutation({ onSuccess: () => { toast.success("Eliminado"); refetch(); }, onError: () => toast.error("Error") });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Catálogo de productos Groupon / Wonderbox / otros</p>
        <Button size="sm" onClick={() => setShowCreate(true)} className="h-8"><Plus className="w-3.5 h-3.5 mr-1.5" />Nuevo producto</Button>
      </div>
      {showCreate && (
        <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-4">
          <p className="font-medium text-foreground text-sm">Nuevo producto ticketing</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-muted-foreground text-xs mb-1.5 block">Nombre *</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej: Kayak 2h Groupon" className="h-9 text-sm" /></div>
            <div><Label className="text-muted-foreground text-xs mb-1.5 block">Proveedor *</Label><Input value={newProvider} onChange={(e) => setNewProvider(e.target.value)} placeholder="Groupon / Wonderbox…" className="h-9 text-sm" /></div>
            <div><Label className="text-muted-foreground text-xs mb-1.5 block">Precio de canje (€)</Label><Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" className="h-9 text-sm" /></div>
            <div><Label className="text-muted-foreground text-xs mb-1.5 block">Descripción</Label><Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Descripción breve…" className="h-9 text-sm" /></div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createMutation.mutate({ name: newName, provider: newProvider, expectedPrice: newPrice || undefined, rules: newDesc || undefined })} disabled={createMutation.isPending || !newName || !newProvider} className="h-8">
              {createMutation.isPending ? "Creando…" : "Crear producto"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)} className="h-8">Cancelar</Button>
          </div>
        </div>
      )}
      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Nombre","Proveedor","Precio canje","Estado",""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : !products?.length ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">No hay productos. Crea el primero.</td></tr>
            ) : (
              products.map((prod) => (
                <tr key={prod.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{prod.name}</p>{prod.rules && <p className="text-muted-foreground text-xs">{prod.rules}</p>}</td>
                  <td className="px-4 py-3 text-foreground text-sm">{prod.provider}</td>
                  <td className="px-4 py-3 text-foreground font-medium">{prod.expectedPrice != null ? `${Number(prod.expectedPrice).toFixed(2)}€` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", prod.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>
                      {prod.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate({ id: prod.id, active: !prod.active })} className="h-7 px-2 text-xs">{prod.active ? "Desactivar" : "Activar"}</Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm("¿Eliminar?")) deleteMutation.mutate({ id: prod.id }); }} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
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

  const kpis = [
    { label: "Total solicitudes", value: metrics?.total ?? 0, color: "text-blue-600", bg: "bg-blue-50", icon: Ticket },
    { label: "Incidencias activas", value: metrics?.incidencias ?? 0, color: "text-red-600", bg: "bg-red-50", icon: AlertTriangle },
    { label: "Pdte. canje proveedor", value: metrics?.pendientesCanje ?? 0, color: "text-amber-600", bg: "bg-amber-50", icon: Clock },
    { label: "Cobrados", value: metrics?.cobrados ?? 0, color: "text-emerald-600", bg: "bg-emerald-50", icon: CheckCircle },
  ];

  return (
    <AdminLayout title="Cupones & Ticketing">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <p className="text-muted-foreground text-sm">Gestión de canjes Groupon, Wonderbox y otros proveedores</p>
        <a href="/canjear-cupon" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 border border-border rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
          <ExternalLink className="w-3.5 h-3.5" />Ver página pública
        </a>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-card rounded-2xl border border-border/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", kpi.bg)}>
                <kpi.icon className={cn("w-5 h-5", kpi.color)} />
              </div>
              <TrendingUp className="w-4 h-4 text-muted-foreground/40" />
            </div>
            <div className={cn("text-2xl font-bold mb-1", kpi.color)}>{kpi.value}</div>
            <div className="text-sm text-muted-foreground">{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/50 border border-border/50 rounded-xl p-1 w-fit mb-6">
        {TABS.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === id
                ? "bg-card text-foreground shadow-sm border border-border/50"
                : "text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="w-3.5 h-3.5" />
            {label}
            {badge != null && badge > 0 && (
              <span className={cn("text-xs px-1.5 py-0.5 rounded-full font-medium", activeTab === id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenido */}
      {activeTab === "solicitudes" && <SolicitudesTab />}
      {activeTab === "incidencias" && <IncidenciasTab />}
      {activeTab === "liquidaciones" && <LiquidacionesTab />}
      {activeTab === "productos" && <ProductosTicketingTab />}
    </AdminLayout>
  );
}
