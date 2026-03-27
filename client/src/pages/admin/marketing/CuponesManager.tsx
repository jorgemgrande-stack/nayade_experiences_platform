/**
 * CuponesManager — Panel Admin: Marketing > Cupones & Ticketing
 * v22.3: alta manual, vista agrupada por submission_id, config emails, acciones completas
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
  Settings, ExternalLink, TrendingUp, Mail,
  Users, ChevronDown, ChevronUp, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TabId = "solicitudes" | "envios" | "incidencias" | "liquidaciones" | "productos" | "config";
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
  alta:      { label: "Alta",      className: "bg-emerald-100 text-emerald-700", score: "≥90%" },
  media:     { label: "Media",     className: "bg-amber-100 text-amber-700",     score: "70-89%" },
  baja:      { label: "Baja",      className: "bg-orange-100 text-orange-700",   score: "40-69%" },
  conflicto: { label: "Conflicto", className: "bg-red-100 text-red-700",         score: "<40%" },
};
const CHANNEL_LABELS: Record<string, string> = {
  web: "Web", email: "Email", whatsapp: "WhatsApp",
  telefono: "Teléfono", presencial: "Presencial", manual: "Manual admin",
};

function StatusOpBadge({ status }: { status: StatusOperational }) {
  const cfg = STATUS_OP_CONFIG[status] ?? STATUS_OP_CONFIG.recibido;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}
function StatusFinBadge({ status }: { status: StatusFinancial }) {
  const cfg = STATUS_FIN_CONFIG[status] ?? STATUS_FIN_CONFIG.pendiente_canje_proveedor;
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>{cfg.label}</span>;
}
function OcrBadge({ status, score }: { status: OcrStatus | null | undefined; score?: number | null }) {
  if (!status) return <span className="text-muted-foreground text-xs">Sin OCR</span>;
  const cfg = OCR_CONFIG[status] ?? OCR_CONFIG.baja;
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", cfg.className)}>{score != null ? `${score}%` : cfg.score}</span>;
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
  const { data: products } = trpc.ticketing.listActiveProducts.useQuery({ provider: data?.provider ?? "Groupon" }, { enabled: !!data });

  if (isLoading) return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl"><div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div></DialogContent>
    </Dialog>
  );
  if (!data) return null;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-amber-500" />
            Cupón #{data.id} — {data.couponCode}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Datos cliente */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-xl border border-border/50">
            <div><p className="text-xs text-muted-foreground mb-0.5">Cliente</p><p className="font-medium text-sm">{data.customerName}</p></div>
            <div><p className="text-xs text-muted-foreground mb-0.5">Email</p><p className="text-sm">{data.email}</p></div>
            {data.phone && <div><p className="text-xs text-muted-foreground mb-0.5">Teléfono</p><p className="text-sm">{data.phone}</p></div>}
            {data.requestedDate && <div><p className="text-xs text-muted-foreground mb-0.5">Fecha solicitada</p><p className="text-sm">{data.requestedDate}</p></div>}
            <div><p className="text-xs text-muted-foreground mb-0.5">Participantes</p><p className="text-sm">{data.participants} adultos{data.children ? ` · ${data.children} niños` : ""}</p></div>
            {data.channelEntry && <div><p className="text-xs text-muted-foreground mb-0.5">Canal</p><p className="text-sm">{CHANNEL_LABELS[data.channelEntry] ?? data.channelEntry}</p></div>}
          </div>

          {/* Datos cupón */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-xl border border-border/50">
            <div><p className="text-xs text-muted-foreground mb-0.5">Proveedor</p><p className="font-medium text-sm">{data.provider}</p></div>
            <div><p className="text-xs text-muted-foreground mb-0.5">Código</p><code className="text-amber-600 font-mono text-sm bg-amber-50 px-2 py-0.5 rounded">{data.couponCode}</code></div>
            {data.securityCode && <div><p className="text-xs text-muted-foreground mb-0.5">Código seguridad</p><code className="font-mono text-sm">{data.securityCode}</code></div>}
            <div><p className="text-xs text-muted-foreground mb-0.5">Estado OCR</p><OcrBadge status={data.ocrStatus as OcrStatus | null} score={data.ocrConfidenceScore} /></div>
            {data.duplicateFlag && <div className="col-span-2"><div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 text-red-500 shrink-0" /><p className="text-red-700 text-xs">{data.duplicateNotes || "Posible duplicado detectado"}</p></div></div>}
          </div>

          {/* Adjunto */}
          {data.attachmentUrl && (
            <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
              <p className="text-xs text-muted-foreground mb-2">Adjunto del cupón</p>
              <div className="flex items-center gap-3">
                <a href={data.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" />Ver adjunto
                </a>
                {!data.ocrStatus && (
                  <Button variant="outline" size="sm" onClick={() => rerunOcr.mutate({ id: data.id })} disabled={rerunOcr.isPending} className="h-7 text-xs">
                    {rerunOcr.isPending ? "Analizando…" : "Ejecutar OCR"}
                  </Button>
                )}
              </div>
              {data.ocrRawData != null && (
                <div className="mt-3 p-3 bg-muted rounded-lg border border-border/50">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">Datos extraídos por OCR</p>
                  <pre className="text-xs text-foreground/70 whitespace-pre-wrap break-all">{String((data.ocrRawData as any) ?? "")}</pre>
                </div>
              )}
            </div>
          )}

          {/* Actualizar estado */}
          <div className="p-4 bg-muted/30 rounded-xl border border-border/50 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Actualizar estado</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Estado operacional</Label>
                <Select value={editStatusOp || data.statusOperational} onValueChange={(v) => setEditStatusOp(v as StatusOperational)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Estado financiero</Label>
                <Select value={editStatusFin || data.statusFinancial} onValueChange={(v) => setEditStatusFin(v as StatusFinancial)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Notas internas</Label>
              <Textarea value={editNotes ?? (data.notes || "")} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="text-sm resize-none" placeholder="Notas internas del equipo…" />
            </div>
            <Button
              onClick={() => updateMutation.mutate({ id: data.id, statusOperational: editStatusOp || undefined, statusFinancial: editStatusFin || undefined, notes: editNotes ?? undefined })}
              disabled={updateMutation.isPending}
              className="h-9"
            >
              {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>

          {/* Convertir a reserva */}
          <div className="p-4 bg-muted/30 rounded-xl border border-border/50">
            <button type="button" onClick={() => setShowConvert(!showConvert)} className="flex items-center justify-between w-full text-sm font-medium text-foreground">
              <span className="flex items-center gap-2"><Ticket className="w-4 h-4 text-violet-500" />Convertir a reserva real</span>
              {showConvert ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showConvert && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-1.5 block">Fecha de reserva</Label>
                    <Input type="date" value={convertDate} onChange={(e) => setConvertDate(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs mb-1.5 block">Experiencia</Label>
                    <Select value={convertProductId} onValueChange={setConvertProductId}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                      <SelectContent>
                        {products?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal: Alta manual de cupón ──────────────────────────────────────────────
function ManualEntryModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    provider: "Groupon", customerName: "", email: "", phone: "",
    couponCode: "", securityCode: "", requestedDate: "",
    participants: 1, children: 0, comments: "", notes: "",
    channelEntry: "manual" as const,
  });
  const { data: products } = trpc.ticketing.listActiveProducts.useQuery({ provider: form.provider });
  const [productId, setProductId] = useState("");

  const mutation = trpc.ticketing.createManualRedemption.useMutation({
    onSuccess: () => { toast.success("Cupón registrado manualmente"); onCreated(); onClose(); },
    onError: (err) => toast.error(err.message || "Error al registrar"),
  });

  const set = (k: string, v: string | number) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-amber-500" />
            Alta manual de cupón
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Nombre cliente *</Label>
              <Input value={form.customerName} onChange={(e) => set("customerName", e.target.value)} className="h-9 text-sm" placeholder="Nombre completo" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="h-9 text-sm" placeholder="email@ejemplo.com" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Teléfono</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-9 text-sm" placeholder="+34 600 000 000" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Fecha solicitada</Label>
              <Input type="date" value={form.requestedDate} onChange={(e) => set("requestedDate", e.target.value)} className="h-9 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Proveedor</Label>
              <Select value={form.provider} onValueChange={(v) => { set("provider", v); setProductId(""); }}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Groupon", "Wonderbox", "SmartBox", "Otro"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Canal de entrada</Label>
              <Select value={form.channelEntry} onValueChange={(v) => set("channelEntry", v)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {products && products.length > 0 && (
            <div>
              <Label className="text-xs mb-1.5 block">Experiencia del cupón</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar experiencia…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin especificar</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Código cupón *</Label>
              <Input value={form.couponCode} onChange={(e) => set("couponCode", e.target.value.toUpperCase())} className="h-9 text-sm font-mono" placeholder="GRP-XXXXXX" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Código seguridad</Label>
              <Input value={form.securityCode} onChange={(e) => set("securityCode", e.target.value.toUpperCase())} className="h-9 text-sm font-mono" placeholder="SEC-XXXX" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Adultos</Label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => set("participants", Math.max(1, form.participants - 1))} className="w-8 h-8 rounded-lg border border-border bg-muted text-sm flex items-center justify-center">−</button>
                <span className="flex-1 text-center text-sm font-medium">{form.participants}</span>
                <button type="button" onClick={() => set("participants", form.participants + 1)} className="w-8 h-8 rounded-lg border border-border bg-muted text-sm flex items-center justify-center">+</button>
              </div>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Niños</Label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => set("children", Math.max(0, form.children - 1))} className="w-8 h-8 rounded-lg border border-border bg-muted text-sm flex items-center justify-center">−</button>
                <span className="flex-1 text-center text-sm font-medium">{form.children}</span>
                <button type="button" onClick={() => set("children", form.children + 1)} className="w-8 h-8 rounded-lg border border-border bg-muted text-sm flex items-center justify-center">+</button>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Comentarios del cliente</Label>
            <Textarea value={form.comments} onChange={(e) => set("comments", e.target.value)} rows={2} className="text-sm resize-none" placeholder="Preferencias, necesidades especiales…" />
          </div>
          <div>
            <Label className="text-xs mb-1.5 block">Notas internas</Label>
            <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className="text-sm resize-none" placeholder="Notas del equipo (no visibles para el cliente)…" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1 h-9">Cancelar</Button>
            <Button
              onClick={() => {
                if (!form.customerName || !form.email || !form.couponCode) { toast.error("Nombre, email y código son obligatorios"); return; }
                mutation.mutate({
                  ...form,
                  productTicketingId: productId && productId !== "none" ? parseInt(productId) : undefined,
                });
              }}
              disabled={mutation.isPending}
              className="flex-1 h-9"
            >
              {mutation.isPending ? "Registrando…" : "Registrar cupón"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab: Solicitudes (vista individual) ─────────────────────────────────────
function SolicitudesTab({ onManualEntry }: { onManualEntry: () => void }) {
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
          <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Estado op." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_OP_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatusFin || "all"} onValueChange={(v) => { setFilterStatusFin(v === "all" ? "" : v as StatusFinancial); setPage(1); }}>
          <SelectTrigger className="h-9 text-sm w-44"><SelectValue placeholder="Estado fin." /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_FIN_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterOcr || "all"} onValueChange={(v) => { setFilterOcr(v === "all" ? "" : v as OcrStatus); setPage(1); }}>
          <SelectTrigger className="h-9 text-sm w-32"><SelectValue placeholder="OCR" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos OCR</SelectItem>
            {Object.entries(OCR_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setFilterDuplicate(filterDuplicate === true ? undefined : true)} className={cn("h-9 text-sm", filterDuplicate && "border-red-300 text-red-600 bg-red-50")}>
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />Duplicados
        </Button>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9"><RefreshCw className="w-3.5 h-3.5" /></Button>
        <Button size="sm" onClick={onManualEntry} className="h-9 ml-auto">
          <Plus className="w-3.5 h-3.5 mr-1.5" />Alta manual
        </Button>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["ID", "Cliente", "Proveedor", "Código", "Fecha sol.", "Estado op.", "Estado fin.", "OCR", "Canal", "Recibido", ""].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 11 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}
                  </tr>
                ))
              ) : data?.items.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">No hay solicitudes con los filtros aplicados</td></tr>
              ) : (
                data?.items.map((item) => (
                  <tr key={item.id} className={cn("border-b border-border hover:bg-muted/30 transition-colors", item.duplicateFlag && "bg-red-50/50")}>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                    <td className="px-4 py-3"><p className="text-foreground font-medium text-sm">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
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
                    <td className="px-4 py-3 text-muted-foreground text-xs">{item.channelEntry ? (CHANNEL_LABELS[item.channelEntry] ?? item.channelEntry) : "—"}</td>
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

// ─── Tab: Envíos agrupados (submission_id) ────────────────────────────────────
function EnviosTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [expandedSid, setExpandedSid] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data, isLoading, refetch } = trpc.ticketing.listSubmissions.useQuery({ page, pageSize: 20, search: search || undefined });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar por nombre, email o código…" className="pl-9 h-9 text-sm" />
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-9"><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)
        ) : data?.items.length === 0 ? (
          <div className="bg-card rounded-2xl border border-border/50 p-12 text-center text-muted-foreground">No hay envíos registrados</div>
        ) : (
          data?.items.map((sub) => (
            <div key={sub.submissionId} className={cn("bg-card rounded-2xl border overflow-hidden transition-all", sub.hasIncidencia ? "border-red-200" : sub.hasDuplicate ? "border-amber-200" : "border-border/50")}>
              <button
                type="button"
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-muted/30 transition-colors text-left"
                onClick={() => setExpandedSid(expandedSid === sub.submissionId ? null : sub.submissionId)}
              >
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-sm text-foreground">{sub.customerName}</p>
                    <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full">{sub.couponCount} cupón{sub.couponCount !== 1 ? "es" : ""}</span>
                    {sub.hasIncidencia && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" />Incidencia</span>}
                    {sub.hasDuplicate && <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">Duplicado</span>}
                  </div>
                  <p className="text-muted-foreground text-xs">{sub.email} · {sub.channelEntry ? (CHANNEL_LABELS[sub.channelEntry] ?? sub.channelEntry) : "Web"} · {new Date(sub.createdAt).toLocaleDateString("es-ES")}</p>
                </div>
                <StatusOpBadge status={sub.statusOperational as StatusOperational} />
                {expandedSid === sub.submissionId ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>

              {expandedSid === sub.submissionId && (
                <div className="border-t border-border/50 bg-muted/20 px-5 py-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/50">
                        {["#", "Proveedor", "Código", "Estado op.", "Estado fin.", "OCR", ""].map((h, i) => (
                          <th key={i} className="text-left py-2 text-muted-foreground text-xs font-medium pr-4">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sub.coupons.map((c) => (
                        <tr key={c.id} className={cn("border-b border-border/30 last:border-0", c.duplicateFlag && "bg-red-50/50")}>
                          <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">#{c.id}</td>
                          <td className="py-2 pr-4 text-xs">{c.provider}</td>
                          <td className="py-2 pr-4"><code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{c.couponCode}</code></td>
                          <td className="py-2 pr-4"><StatusOpBadge status={c.statusOperational as StatusOperational} /></td>
                          <td className="py-2 pr-4"><StatusFinBadge status={c.statusFinancial as StatusFinancial} /></td>
                          <td className="py-2 pr-4"><OcrBadge status={c.ocrStatus as OcrStatus | null} score={c.ocrConfidenceScore} /></td>
                          <td className="py-2"><Button variant="ghost" size="sm" onClick={() => setSelectedId(c.id)} className="h-6 w-6 p-0"><Eye className="w-3 h-3" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">{data.total} envíos · Página {data.page} de {data.totalPages}</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="h-7 w-7 p-0"><ChevronLeft className="w-3.5 h-3.5" /></Button>
            <Button variant="ghost" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="h-7 w-7 p-0"><ChevronRight className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      )}
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
              {["ID", "Cliente", "Código", "Proveedor", "Estado financiero", "Canal", "Recibido", ""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : data?.items.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No hay incidencias activas</td></tr>
            ) : (
              data?.items.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
                  <td className="px-4 py-3"><code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{item.couponCode}</code></td>
                  <td className="px-4 py-3 text-foreground text-sm">{item.provider}</td>
                  <td className="px-4 py-3"><StatusFinBadge status={item.statusFinancial as StatusFinancial} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{item.channelEntry ? (CHANNEL_LABELS[item.channelEntry] ?? item.channelEntry) : "—"}</td>
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
          { label: "Pdte. canje proveedor", value: pendientes.length, color: "text-amber-600", bg: "bg-amber-50", icon: Clock },
          { label: "Total a liquidar", value: `${pendientes.length} cupones`, color: "text-blue-600", bg: "bg-blue-50", icon: DollarSign },
          { label: "Última actualización", value: new Date().toLocaleDateString("es-ES"), color: "text-muted-foreground", bg: "bg-muted", icon: RefreshCw },
        ].map(({ label, value, color, bg, icon: Icon }) => (
          <div key={label} className="bg-card rounded-2xl border border-border/50 p-4">
            <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center mb-3", bg)}>
              <Icon className={cn("w-4 h-4", color)} />
            </div>
            <p className={cn("text-xl font-bold", color)}>{value}</p>
            <p className="text-muted-foreground text-xs mt-0.5">{label}</p>
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
              {["ID", "Cliente", "Código", "Proveedor", "Fecha sol.", "Estado op.", "Canal", "Recibido", ""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : pendientes.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">No hay cupones pendientes de liquidación</td></tr>
            ) : (
              pendientes.map((item) => (
                <tr key={item.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{item.id}</td>
                  <td className="px-4 py-3"><p className="text-foreground font-medium">{item.customerName}</p><p className="text-muted-foreground text-xs">{item.email}</p></td>
                  <td className="px-4 py-3"><code className="text-amber-600 font-mono text-xs bg-amber-50 px-1.5 py-0.5 rounded">{item.couponCode}</code></td>
                  <td className="px-4 py-3 text-foreground text-sm">{item.provider}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{item.requestedDate || "—"}</td>
                  <td className="px-4 py-3"><StatusOpBadge status={item.statusOperational as StatusOperational} /></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{item.channelEntry ? (CHANNEL_LABELS[item.channelEntry] ?? item.channelEntry) : "—"}</td>
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

// ─── Tab: Productos Ticketing ─────────────────────────────────────────────────
function ProductosTicketingTab() {
  const { data: products, isLoading, refetch } = trpc.ticketing.listProducts.useQuery(undefined);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", provider: "Groupon", rules: "", expectedPrice: "" });
  const createMutation = trpc.ticketing.createProduct.useMutation({
    onSuccess: () => { toast.success("Producto creado"); refetch(); setShowNew(false); setNewForm({ name: "", provider: "Groupon", rules: "", expectedPrice: "" }); },
    onError: () => toast.error("Error al crear producto"),
  });
  const toggleMutation = trpc.ticketing.updateProduct.useMutation({
    onSuccess: () => { toast.success("Actualizado"); refetch(); },
    onError: () => toast.error("Error al actualizar"),
  });
  const deleteMutation = trpc.ticketing.deleteProduct.useMutation({
    onSuccess: () => { toast.success("Eliminado"); refetch(); },
    onError: () => toast.error("Error al eliminar"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Catálogo de productos Groupon / Wonderbox configurados</p>
        <Button size="sm" onClick={() => setShowNew(!showNew)} className="h-9">
          <Plus className="w-3.5 h-3.5 mr-1.5" />Nuevo producto
        </Button>
      </div>

      {showNew && (
        <div className="bg-card rounded-2xl border border-border/50 p-5 space-y-3">
          <p className="font-medium text-sm">Nuevo producto ticketing</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">Nombre *</Label>
              <Input value={newForm.name} onChange={(e) => setNewForm(p => ({ ...p, name: e.target.value }))} className="h-9 text-sm" placeholder="Ej: Pack Esquí 1 día adulto" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Proveedor</Label>
              <Select value={newForm.provider} onValueChange={(v) => setNewForm(p => ({ ...p, provider: v }))}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Groupon", "Wonderbox", "SmartBox", "Otro"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Precio esperado (€)</Label>
              <Input value={newForm.expectedPrice} onChange={(e) => setNewForm(p => ({ ...p, expectedPrice: e.target.value }))} className="h-9 text-sm" placeholder="0.00" type="number" step="0.01" />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Reglas / notas</Label>
              <Input value={newForm.rules} onChange={(e) => setNewForm(p => ({ ...p, rules: e.target.value }))} className="h-9 text-sm" placeholder="Condiciones del cupón" />
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowNew(false)} className="h-9">Cancelar</Button>
            <Button onClick={() => {
              if (!newForm.name) { toast.error("El nombre es obligatorio"); return; }
              createMutation.mutate({ name: newForm.name, provider: newForm.provider, rules: newForm.rules || undefined, expectedPrice: newForm.expectedPrice || undefined } as any);
            }} disabled={createMutation.isPending} className="h-9">
              {createMutation.isPending ? "Creando…" : "Crear producto"}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border/50 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["ID", "Nombre", "Proveedor", "Precio canónico", "Estado", ""].map((h, i) => (
                <th key={i} className="text-left px-4 py-3 text-muted-foreground text-xs font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" /></td></tr>
            ) : !products || products.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No hay productos configurados. Crea el primero con el botón de arriba.</td></tr>
            ) : (
              (products ?? []).map((prod) => (
                <tr key={prod.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">#{prod.id}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{prod.name}</td>
                  <td className="px-4 py-3 text-muted-foreground text-sm">{prod.provider}</td>
                  <td className="px-4 py-3 text-foreground text-sm">{prod.expectedPrice ? `${prod.expectedPrice} €` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", prod.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600")}>
                      {prod.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => toggleMutation.mutate({ id: prod.id, active: !prod.active })} className="h-7 px-2 text-xs">{prod.active ? "Desactivar" : "Activar"}</Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm("¿Eliminar este producto?")) deleteMutation.mutate({ id: prod.id }); }} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></Button>
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

// ─── Tab: Configuración de emails ─────────────────────────────────────────────
function ConfigEmailTab() {
  const { data: cfg, isLoading, refetch } = trpc.ticketing.getEmailConfig.useQuery();
  const updateMutation = trpc.ticketing.updateEmailConfig.useMutation({
    onSuccess: () => { toast.success("Configuración guardada"); refetch(); },
    onError: () => toast.error("Error al guardar"),
  });
  const [form, setForm] = useState<{
    autoSendCouponReceived: boolean;
    autoSendCouponValidated: boolean;
    autoSendInternalAlert: boolean;
    emailMode: "per_submission" | "per_coupon";
    internalAlertEmail: string;
  } | null>(null);

  // Inicializar form cuando llegan los datos
  if (cfg && !form) {
    setForm({
      autoSendCouponReceived: cfg.autoSendCouponReceived ?? true,
      autoSendCouponValidated: cfg.autoSendCouponValidated ?? true,
      autoSendInternalAlert: cfg.autoSendInternalAlert ?? true,
      emailMode: (cfg.emailMode as "per_submission" | "per_coupon") ?? "per_submission",
      internalAlertEmail: cfg.internalAlertEmail ?? "reservas@nayadeexperiences.es",
    });
  }

  if (isLoading || !form) return <div className="flex items-center justify-center py-12"><div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" /></div>;

  const toggle = (k: keyof typeof form) => setForm((p) => p ? { ...p, [k]: !p[k as keyof typeof p] } : p);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="bg-card rounded-2xl border border-border/50 p-6 space-y-5">
        <p className="font-semibold text-sm text-foreground">Emails automáticos al cliente</p>

        {[
          { key: "autoSendCouponReceived" as const, label: "Confirmación de recepción", desc: "Enviar email al cliente cuando se registra su solicitud de canje" },
          { key: "autoSendCouponValidated" as const, label: "Confirmación de validación", desc: "Enviar email al cliente cuando su cupón es validado por el equipo" },
        ].map(({ key, label, desc }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
            <button
              type="button"
              onClick={() => toggle(key)}
              className={cn("w-10 h-6 rounded-full transition-colors shrink-0 relative", form[key] ? "bg-primary" : "bg-muted border border-border")}
            >
              <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", form[key] ? "left-[18px]" : "left-0.5")} />
            </button>
          </div>
        ))}

        <div>
          <p className="text-sm font-medium text-foreground mb-1.5">Modo de envío</p>
          <p className="text-xs text-muted-foreground mb-3">¿Un email por envío completo (recomendado) o un email por cada cupón individual?</p>
          <div className="flex gap-3">
            {[
              { value: "per_submission" as const, label: "Por envío", desc: "1 email para todos los cupones del mismo formulario" },
              { value: "per_coupon" as const, label: "Por cupón", desc: "1 email por cada cupón registrado" },
            ].map(({ value, label, desc }) => (
              <button
                key={value}
                type="button"
                onClick={() => setForm((p) => p ? { ...p, emailMode: value } : p)}
                className={cn("flex-1 p-3 rounded-xl border text-left transition-all", form.emailMode === value ? "border-primary bg-primary/5" : "border-border hover:border-border/80")}
              >
                <p className={cn("text-sm font-medium", form.emailMode === value ? "text-primary" : "text-foreground")}>{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-2xl border border-border/50 p-6 space-y-4">
        <p className="font-semibold text-sm text-foreground">Alertas internas al equipo</p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Alerta de nuevo envío</p>
            <p className="text-xs text-muted-foreground mt-0.5">Notificar al equipo cuando se recibe una nueva solicitud de canje</p>
          </div>
          <button
            type="button"
            onClick={() => toggle("autoSendInternalAlert")}
            className={cn("w-10 h-6 rounded-full transition-colors shrink-0 relative", form.autoSendInternalAlert ? "bg-primary" : "bg-muted border border-border")}
          >
            <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all", form.autoSendInternalAlert ? "left-[18px]" : "left-0.5")} />
          </button>
        </div>
        <div>
          <Label className="text-xs mb-1.5 block">Email de alertas internas</Label>
          <Input
            value={form.internalAlertEmail}
            onChange={(e) => setForm((p) => p ? { ...p, internalAlertEmail: e.target.value } : p)}
            className="h-9 text-sm"
            placeholder="reservas@nayadeexperiences.es"
            type="email"
          />
        </div>
      </div>

      <Button onClick={() => updateMutation.mutate(form)} disabled={updateMutation.isPending} className="h-10 px-8">
        <Mail className="w-4 h-4 mr-2" />
        {updateMutation.isPending ? "Guardando…" : "Guardar configuración"}
      </Button>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CuponesManager() {
  const [activeTab, setActiveTab] = useState<TabId>("solicitudes");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const { data: metrics } = trpc.ticketing.getMetrics.useQuery();

  const TABS: { id: TabId; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: "solicitudes", label: "Solicitudes", icon: Ticket, badge: metrics?.total },
    { id: "envios", label: "Envíos", icon: Layers },
    { id: "incidencias", label: "Incidencias", icon: AlertTriangle, badge: metrics?.incidencias || undefined },
    { id: "liquidaciones", label: "Liquidaciones", icon: DollarSign, badge: metrics?.pendientesCanje || undefined },
    { id: "productos", label: "Productos", icon: Settings },
    { id: "config", label: "Config. emails", icon: Mail },
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
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setShowManualEntry(true)} className="h-9">
            <Plus className="w-3.5 h-3.5 mr-1.5" />Alta manual
          </Button>
          <a href="/canjear-cupon" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border border-border rounded-xl px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all h-9">
            <ExternalLink className="w-3.5 h-3.5" />Página pública
          </a>
        </div>
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
      <div className="flex flex-wrap gap-1 bg-muted/50 border border-border/50 rounded-xl p-1 w-fit mb-6">
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
      {activeTab === "solicitudes" && <SolicitudesTab onManualEntry={() => setShowManualEntry(true)} />}
      {activeTab === "envios" && <EnviosTab />}
      {activeTab === "incidencias" && <IncidenciasTab />}
      {activeTab === "liquidaciones" && <LiquidacionesTab />}
      {activeTab === "productos" && <ProductosTicketingTab />}
      {activeTab === "config" && <ConfigEmailTab />}

      {/* Modal alta manual */}
      {showManualEntry && <ManualEntryModal onClose={() => setShowManualEntry(false)} onCreated={() => {}} />}
    </AdminLayout>
  );
}
