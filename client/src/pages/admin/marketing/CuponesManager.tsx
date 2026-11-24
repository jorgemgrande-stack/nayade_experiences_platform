/**
 * CuponesManager — Pipeline de Cupones & Ticketing
 * v23.1: Diseño oscuro tipo CRM · Pipeline Recibido→Pendiente→Reserva generada
 * Estados financieros: Pendiente canjear · Canjeado · Incidencia
 * Proveedores fijos: Groupon, Smartbox, CheckYeti, Atrapalo, Jumping, Alpine Resort, Civitatis
 */
import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";
import { PanelPageHeader, PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { MetricCard, PersonAvatar, SegmentedTabs } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Ticket, Search, Plus, Eye, CalendarCheck, Clock, AlertTriangle,
  CheckCircle, RefreshCw, Filter, TrendingUp, Banknote, ChevronRight,
  FileText, Pause, Zap, ExternalLink, Settings, BadgeCheck, Upload, X, Trash2,
} from "lucide-react";

// ─── TIPOS ────────────────────────────────────────────────────────────────────
type Tab = "todos" | "pendientes" | "reservas_generadas" | "incidencias" | "liquidaciones";
type StatusOp = "recibido" | "pendiente" | "reserva_generada";
type StatusFin = "pendiente_canjear" | "canjeado" | "incidencia";

interface Coupon {
  id: number;
  provider: string;
  customerName: string;
  email: string;
  phone?: string | null;
  couponCode: string;
  securityCode?: string | null;
  requestedDate?: string | null;
  station?: string | null;
  participants?: number | null;
  statusOperational: StatusOp;
  statusFinancial: StatusFin;
  duplicateFlag: boolean;
  notes?: string | null;
  reservationId?: number | null;
  attachmentUrl?: string | null;
  ocrConfidenceScore?: number | null;
  ocrStatus?: string | null;
  createdAt: Date;
}

// ─── PROVEEDORES FIJOS ────────────────────────────────────────────────────────
const PROVIDERS = ["Groupon", "Smartbox", "CheckYeti", "Atrapalo", "Jumping", "Alpine Resort", "Civitatis"];

/** Cada proveedor se distingue por un tono con significado del sistema (no por un color propio). */
const PROVIDER_TONES: Record<string, Tone> = {
  Groupon: "success",
  Smartbox: "info",
  CheckYeti: "info",
  Atrapalo: "warning",
  Jumping: "warning",
  "Alpine Resort": "info",
  Civitatis: "brand",
};

// ─── BADGES ───────────────────────────────────────────────────────────────────
function ProviderBadge({ provider }: { provider: string }) {
  return <StatusBadge tone={PROVIDER_TONES[provider] ?? "neutral"}>{provider}</StatusBadge>;
}

function OpBadge({ status }: { status: StatusOp }) {
  const map: Record<StatusOp, { label: string; tone: Tone; icon: React.ReactNode }> = {
    recibido: { label: "Recibido", tone: "info", icon: <Ticket /> },
    pendiente: { label: "Pendiente", tone: "warning", icon: <Clock /> },
    reserva_generada: { label: "Reserva generada", tone: "success", icon: <CheckCircle /> },
  };
  const { label, tone, icon } = map[status] ?? map.recibido;
  return <StatusBadge tone={tone} icon={icon}>{label}</StatusBadge>;
}

function FinBadge({ status }: { status: StatusFin }) {
  const map: Record<StatusFin, { label: string; tone: Tone }> = {
    pendiente_canjear: { label: "Pendiente canjear", tone: "neutral" },
    canjeado: { label: "Canjeado", tone: "success" },
    incidencia: { label: "Incidencia", tone: "danger" },
  };
  const { label, tone } = map[status] ?? map.pendiente_canjear;
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

/** Botón de icono de una fila: con nombre accesible, un objetivo táctil cómodo y el color de su significado. */
const ACTION_TONE: Record<string, string> = {
  neutral: "text-muted-foreground hover:text-foreground",
  warning: "text-warning hover:bg-warning/10",
  success: "text-success hover:bg-success/10",
  danger: "text-danger hover:bg-danger/10",
  info: "text-info hover:bg-info/10",
};
function RowAction({ label, tone = "neutral", onClick, disabled, children }: { label: string; tone?: keyof typeof ACTION_TONE; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon" className={`h-9 w-9 ${ACTION_TONE[tone]}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

// ─── DETAIL MODAL ─────────────────────────────────────────────────────────────
function DetailModal({ coupon, onClose, onConvert, onRedeem, onPostpone, onIncidence }: {
  coupon: Coupon;
  onClose: () => void;
  onConvert: (c: Coupon) => void;
  onRedeem: (c: Coupon) => void;
  onPostpone: (c: Coupon) => void;
  onIncidence: (c: Coupon) => void;
}) {
  const rerunOcr = trpc.ticketing.rerunOcr.useMutation({
    onSuccess: (res) => toast.success(`OCR completado: ${res.score}% (${res.status})`),
    onError: () => toast.error("Error al ejecutar OCR"),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" />
            Detalle del cupón #{coupon.id}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Cliente */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
              {coupon.customerName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-foreground">{coupon.customerName}</p>
              <p className="text-sm text-muted-foreground">{coupon.email}</p>
              {coupon.phone && <p className="text-sm text-muted-foreground">{coupon.phone}</p>}
            </div>
          </div>
          {/* Info cupón */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Código cupón</p>
              <code className="text-primary font-mono">{coupon.couponCode}</code>
              {coupon.duplicateFlag && <span className="ml-2 text-xs text-warning">⚠ Posible duplicado</span>}
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Proveedor</p>
              <ProviderBadge provider={coupon.provider} />
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Estado operacional</p>
              <OpBadge status={coupon.statusOperational} />
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Estado financiero</p>
              <FinBadge status={coupon.statusFinancial} />
            </div>
            {coupon.requestedDate && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-muted-foreground text-xs mb-1">Fecha solicitada</p>
                <p className="text-foreground">{coupon.requestedDate}</p>
              </div>
            )}
            {coupon.station && (
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-muted-foreground text-xs mb-1">Estación</p>
                <p className="text-foreground">{coupon.station}</p>
              </div>
            )}
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Participantes</p>
              <p className="text-foreground">{coupon.participants ?? 1}</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Recibido</p>
              <p className="text-foreground">{new Date(coupon.createdAt).toLocaleDateString("es-ES")}</p>
            </div>
          </div>
          {/* Notas */}
          {coupon.notes && (
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-muted-foreground text-xs mb-1">Notas</p>
              <p className="text-foreground text-sm">{coupon.notes}</p>
            </div>
          )}
          {/* Reserva generada */}
          {coupon.reservationId && (
            <div className="p-3 rounded-lg bg-success/10 border border-success/20">
              <p className="text-success text-sm flex items-center gap-1">
                <CheckCircle className="w-4 h-4" />
                Reserva #{coupon.reservationId} generada en el CRM
              </p>
            </div>
          )}
          {/* Adjunto + OCR */}
          {coupon.attachmentUrl && (
            <div className="p-3 rounded-lg bg-muted/50 space-y-2">
              <p className="text-muted-foreground text-xs">Adjunto del cupón</p>
              <div className="flex items-center gap-3">
                <a href={coupon.attachmentUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-primary hover:text-primary">
                  <ExternalLink className="w-4 h-4" /> Ver adjunto
                </a>
                {coupon.ocrStatus && (
                  <span className="text-xs text-muted-foreground">OCR: {coupon.ocrConfidenceScore}%</span>
                )}
                {!coupon.ocrStatus && (
                  <Button variant="outline" size="sm" onClick={() => rerunOcr.mutate({ id: coupon.id })}
                    disabled={rerunOcr.isPending}
                    className="h-7 text-xs border-border text-foreground/60">
                    {rerunOcr.isPending ? "Analizando..." : "Ejecutar OCR"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} className="border-border text-foreground/70">Cerrar</Button>
          {coupon.statusOperational === "recibido" && (
            <Button className="bg-warning hover:bg-warning/90 text-primary-foreground" onClick={() => { onClose(); onPostpone(coupon); }}>
              <Pause className="w-4 h-4 mr-1" /> Posponer
            </Button>
          )}
          {coupon.statusFinancial !== "incidencia" && coupon.statusOperational !== "reserva_generada" && (
            <Button variant="destructive" onClick={() => { onClose(); onIncidence(coupon); }}>
              <AlertTriangle className="w-4 h-4 mr-1" /> Incidencia
            </Button>
          )}
          {coupon.statusFinancial === "pendiente_canjear" && (
            <Button className="bg-success hover:bg-success/90 text-primary-foreground" onClick={() => { onClose(); onRedeem(coupon); }}>
              <BadgeCheck className="w-4 h-4 mr-1" /> Marcar como canjeado
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── CONVERT MODAL ──────────────────────────────────────────────────────────
interface ConvertFormState {
  reservationDate: string;
  participants: number;
  platformProductId: number | undefined;
  selectedPlatformId: number | undefined;
}

function ConvertModal({
  coupon, convertForm, setConvertForm, convertMutation, onClose,
}: {
  coupon: Coupon;
  convertForm: ConvertFormState;
  setConvertForm: React.Dispatch<React.SetStateAction<ConvertFormState>>;
  convertMutation: ReturnType<typeof trpc.ticketing.convertToReservation.useMutation>;
  onClose: () => void;
}) {
  // Cargar plataformas activas
  const platformsQuery = trpc.ticketing.listPlatforms.useQuery();
  const platforms = platformsQuery.data ?? [];

  // Cargar productos de la plataforma seleccionada
  const productsQuery = trpc.ticketing.listPlatformProducts.useQuery(
    { platformId: convertForm.selectedPlatformId! },
    { enabled: !!convertForm.selectedPlatformId }
  );
  const products = (productsQuery.data ?? []).filter((p: { active: boolean }) => p.active);

  // Producto seleccionado (para mostrar PVP/neto)
  const selectedProduct = products.find((p: { id: number }) => p.id === convertForm.platformProductId);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-success" />
            Convertir en reserva
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Info cupón */}
          <div className="p-3 rounded-lg bg-muted/50 text-sm">
            <p className="text-foreground/60">Cliente: <span className="text-foreground font-medium">{coupon.customerName}</span></p>
            <p className="text-foreground/60 mt-0.5">Cupón: <code className="text-primary">{coupon.couponCode}</code> · <ProviderBadge provider={coupon.provider} /></p>
          </div>

          {/* Selector de plataforma */}
          <div>
            <Label className="text-foreground/70 text-sm">Plataforma *</Label>
            <Select
              value={convertForm.selectedPlatformId?.toString() ?? ""}
              onValueChange={(v) => setConvertForm(f => ({ ...f, selectedPlatformId: parseInt(v), platformProductId: undefined }))}
            >
              <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1">
                <SelectValue placeholder="Selecciona la plataforma del cupón" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {platforms.map((pl: { id: number; name: string }) => (
                  <SelectItem key={pl.id} value={pl.id.toString()}>{pl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selector de producto de plataforma */}
          {convertForm.selectedPlatformId && (
            <div>
              <Label className="text-foreground/70 text-sm">Producto *</Label>
              {productsQuery.isPending ? (
                <p className="text-muted-foreground text-sm mt-2">Cargando productos...</p>
              ) : products.length === 0 ? (
                <p className="text-warning text-sm mt-2">No hay productos activos en esta plataforma. Configúralos en Plataformas.</p>
              ) : (
                <Select
                  value={convertForm.platformProductId?.toString() ?? ""}
                  onValueChange={(v) => setConvertForm(f => ({ ...f, platformProductId: parseInt(v) }))}
                >
                  <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1">
                    <SelectValue placeholder="Selecciona el producto" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {products.map((p: { id: number; externalProductName?: string | null; pvpPrice?: string | null; netPrice?: string | null; expiresAt?: Date | null }) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        <span>{p.externalProductName ?? `Producto #${p.id}`}</span>
                        {p.pvpPrice && <span className="ml-2 text-muted-foreground text-xs">PVP: {p.pvpPrice}€</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Detalle del producto seleccionado */}
          {selectedProduct && (
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-lg bg-success/10 border border-success/20 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">PVP</p>
                <p className="text-success font-bold">{selectedProduct.pvpPrice ?? "—"}€</p>
              </div>
              <div className="p-2.5 rounded-lg bg-info/10 border border-info/20 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Precio neto</p>
                <p className="text-info font-bold">{selectedProduct.netPrice ?? "—"}€</p>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/50 border border-border text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Caduca</p>
                <p className="text-foreground/70 text-sm">
                  {selectedProduct.expiresAt
                    ? new Date(selectedProduct.expiresAt).toLocaleDateString("es-ES")
                    : "Sin caducidad"}
                </p>
              </div>
            </div>
          )}

          {/* Fecha y participantes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-foreground/70 text-sm">Fecha de reserva *</Label>
              <Input type="date" value={convertForm.reservationDate}
                onChange={(e) => setConvertForm(f => ({ ...f, reservationDate: e.target.value }))}
                className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-sm">Participantes</Label>
              <Input type="number" min={1} value={convertForm.participants}
                onChange={(e) => setConvertForm(f => ({ ...f, participants: parseInt(e.target.value) || 1 }))}
                className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
          </div>

          {/* Resumen de importes */}
          {selectedProduct && convertForm.participants > 0 && (
            <div className="p-3 rounded-lg bg-muted/50 border border-border/50 text-sm">
              <div className="flex justify-between text-foreground/60">
                <span>Importe total (PVP × {convertForm.participants} pax)</span>
                <span className="text-foreground font-medium">
                  {((parseFloat(selectedProduct.pvpPrice ?? "0")) * convertForm.participants).toFixed(2)}€
                </span>
              </div>
              <div className="flex justify-between text-foreground/60 mt-1">
                <span>Importe neto (lo que pagamos al proveedor)</span>
                <span className="text-info font-medium">
                  {((parseFloat(selectedProduct.netPrice ?? "0")) * convertForm.participants).toFixed(2)}€
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            La plataforma ya confirmó el canje. Se creará la reserva en el CRM con origen "Plataforma". El cupón pasará a estado "Reserva generada".
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-foreground/70">Cancelar</Button>
          <Button className="bg-success hover:bg-success/90 text-primary-foreground"
            disabled={!convertForm.reservationDate || !convertForm.platformProductId || convertMutation.isPending}
            onClick={() => {
              convertMutation.mutate({
                id: coupon.id,
                platformProductId: convertForm.platformProductId,
                reservationDate: convertForm.reservationDate,
                participants: convertForm.participants,
                providerTag: coupon.provider,
              });
            }}>
            {convertMutation.isPending ? "Creando reserva..." : "Crear reserva en CRM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CuponesManager() {
  const [activeTab, setActiveTab] = useState<Tab>("todos");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [page, setPage] = useState(1);

  // Modals
  const [detailCoupon, setDetailCoupon] = useState<Coupon | null>(null);
  const [convertCoupon, setConvertCoupon] = useState<Coupon | null>(null);
  const [postponeCoupon, setPostponeCoupon] = useState<Coupon | null>(null);
  const [incidenceCoupon, setIncidenceCoupon] = useState<Coupon | null>(null);
  const [redeemCoupon, setRedeemCoupon] = useState<Coupon | null>(null);
  const [deleteCoupon, setDeleteCoupon] = useState<Coupon | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  // Form states
  const [convertForm, setConvertForm] = useState({ reservationDate: "", participants: 1, platformProductId: undefined as number | undefined, selectedPlatformId: undefined as number | undefined });
  const [postponeNotes, setPostponeNotes] = useState("");
  const [incidenceNotes, setIncidenceNotes] = useState("");
  const [manualForm, setManualForm] = useState({
    provider: "Groupon", customerName: "", email: "", phone: "", couponCode: "",
    securityCode: "", requestedDate: "", station: "", participants: 1, children: 0,
    comments: "", channelEntry: "manual" as const, notes: "", attachmentUrl: "",
  });
  const [manualAttachName, setManualAttachName] = useState("");
  const [manualAttachError, setManualAttachError] = useState("");

  // ── QUERIES ──────────────────────────────────────────────────────────────
  const statsQuery = trpc.ticketing.getDashboardStats.useQuery(undefined, { refetchInterval: 30000 });

  const statusOpFilter = useMemo((): StatusOp | undefined => {
    if (activeTab === "pendientes") return "pendiente";
    if (activeTab === "reservas_generadas") return "reserva_generada";
    return undefined;
  }, [activeTab]);

  const statusFinFilter = useMemo((): StatusFin | undefined => {
    if (activeTab === "incidencias") return "incidencia";
    return undefined;
  }, [activeTab]);

  const couponsQuery = trpc.ticketing.listCoupons.useQuery({
    page,
    pageSize: 25,
    search: search || undefined,
    provider: providerFilter !== "all" ? providerFilter : undefined,
    statusOperational: statusOpFilter,
    statusFinancial: statusFinFilter,
  });

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.ticketing.listCoupons.invalidate();
    utils.ticketing.getDashboardStats.invalidate();
  };

  // ── MUTATIONS ─────────────────────────────────────────────────────────────
  const convertMutation = trpc.ticketing.convertToReservation.useMutation({
    onSuccess: () => { toast.success("Reserva creada en el CRM — cupón completamente procesado"); setConvertCoupon(null); setConvertForm({ reservationDate: "", participants: 1, platformProductId: undefined, selectedPlatformId: undefined }); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const postponeMutation = trpc.ticketing.postponeCoupon.useMutation({
    onSuccess: () => { toast.success("Cupón pospuesto. Email enviado al cliente."); setPostponeCoupon(null); setPostponeNotes(""); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const incidenceMutation = trpc.ticketing.markIncidence.useMutation({
    onSuccess: () => { toast.success("Incidencia registrada"); setIncidenceCoupon(null); setIncidenceNotes(""); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const markAsRedeemedMutation = trpc.ticketing.markAsRedeemed.useMutation({
    onSuccess: (res) => {
      toast.success(res.reservationId ? "Cupón canjeado y reserva creada en el CRM" : "Cupón marcado como canjeado");
      setRedeemCoupon(null);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteRedemptionMutation = trpc.ticketing.deleteRedemption.useMutation({
    onSuccess: (res) => { toast.success(`Cupón ${res.couponCode} eliminado`); setDeleteCoupon(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const regenerateMutation = trpc.ticketing.regenerateReservationOperation.useMutation({
    onSuccess: (res) => {
      toast.success(`Operación regenerada${res.emailSent ? " · email reenviado" : ""} (booking #${res.bookingId ?? "—"}, tx #${res.transactionId ?? "—"})`);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const createManualMutation = trpc.ticketing.createManualRedemption.useMutation({
    onSuccess: () => {
      toast.success("Cupón registrado manualmente");
      setManualOpen(false);
      setManualForm({ provider: "Groupon", customerName: "", email: "", phone: "", couponCode: "", securityCode: "", requestedDate: "", station: "", participants: 1, children: 0, comments: "", channelEntry: "manual", notes: "", attachmentUrl: "" });
      setManualAttachName("");
      setManualAttachError("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const manualUploadMutation = trpc.ticketing.uploadCouponAttachment.useMutation();

  const stats = statsQuery.data;
  const coupons = (couponsQuery.data?.items ?? []) as Coupon[];
  const totalPages = couponsQuery.data?.totalPages ?? 1;

  // ── TABS ──────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "todos", label: "Todos", count: stats?.total },
    { id: "pendientes", label: "Pendientes", count: stats?.pendientes },
    { id: "reservas_generadas", label: "Reservas generadas", count: stats?.convertidos },
    { id: "incidencias", label: "Incidencias", count: stats?.incidencias },
    { id: "liquidaciones", label: "Liquidaciones" },
  ];

  const columns: PanelColumn<Coupon>[] = [
    {
      key: "cliente",
      header: "Cliente",
      cell: (c) => (
        <div className="flex min-w-[11rem] items-center gap-2.5">
          <PersonAvatar name={c.customerName} id={c.id} size="sm" />
          <div className="min-w-0">
            <p className="break-words text-sm font-medium text-foreground">{c.customerName}</p>
            <p className="break-words text-xs font-normal text-muted-foreground">{c.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "codigo",
      header: "Cupón",
      cell: (c) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <code className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">{c.couponCode}</code>
          <ProviderBadge provider={c.provider} />
          {c.duplicateFlag && <StatusBadge tone="warning" icon={<AlertTriangle />}>Posible duplicado</StatusBadge>}
        </div>
      ),
    },
    {
      key: "estado",
      header: "Estado",
      cell: (c) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <OpBadge status={c.statusOperational} />
          <FinBadge status={c.statusFinancial} />
        </div>
      ),
    },
    {
      key: "fecha",
      header: "Fecha",
      cell: (c) => (
        <span className="text-xs text-muted-foreground">
          {new Date(c.createdAt).toLocaleDateString("es-ES")}
          {c.requestedDate && <span className="block">Pide: {c.requestedDate}</span>}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cell: (c) => (
        <div className="flex flex-nowrap items-center justify-end gap-0.5">
          <RowAction label="Ver detalle" onClick={() => setDetailCoupon(c)}><Eye className="h-4 w-4" /></RowAction>
          {c.statusOperational === "recibido" && (
            <RowAction label="Posponer" tone="warning" onClick={() => { setPostponeCoupon(c); setPostponeNotes(""); }}><Pause className="h-4 w-4" /></RowAction>
          )}
          {c.statusFinancial === "pendiente_canjear" && (
            <RowAction label="Marcar como canjeado" tone="success" onClick={() => setRedeemCoupon(c)}><BadgeCheck className="h-4 w-4" /></RowAction>
          )}
          {c.statusFinancial !== "incidencia" && (
            <RowAction label="Marcar incidencia" tone="danger" onClick={() => { setIncidenceCoupon(c); setIncidenceNotes(""); }}><AlertTriangle className="h-4 w-4" /></RowAction>
          )}
          {c.statusOperational === "reserva_generada" && c.reservationId && (
            <RowAction label="Regenerar operación y reenviar email" tone="info" disabled={regenerateMutation.isPending} onClick={() => regenerateMutation.mutate({ reservationId: c.reservationId! })}><Zap className="h-4 w-4" /></RowAction>
          )}
          <RowAction label="Eliminar cupón" tone="danger" onClick={() => setDeleteCoupon(c)}><Trash2 className="h-4 w-4" /></RowAction>
        </div>
      ),
    },
  ];

  return (
    <AdminLayout>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <PanelPageHeader
            className="mb-0"
            icon={<Ticket />}
            title="Pipeline de Cupones"
            description="Recibido → Pendiente → Reserva generada · Trazabilidad completa por proveedor"
            actions={<>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/marketing/plataformas"><Settings className="mr-1 h-4 w-4" /> Plataformas</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => { utils.ticketing.listCoupons.invalidate(); utils.ticketing.getDashboardStats.invalidate(); }}>
                <RefreshCw className="mr-1 h-4 w-4" /> Actualizar
              </Button>
              <Button size="sm" onClick={() => setManualOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Alta manual
              </Button>
            </>}
          />

          {/* ── INDICADORES: los cuatro del pipeline son accesos a su vista ───── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard tone="info" icon={<Ticket />} label="Cupones recibidos" value={stats?.recibidos ?? 0} detail="Sin procesar" className="bg-gradient-to-br from-info/10 to-card" onClick={() => { setActiveTab("todos"); setPage(1); }} active={activeTab === "todos"} />
            <MetricCard tone="warning" icon={<Clock />} label="Pendientes" value={stats?.pendientes ?? 0} detail="Sin disponibilidad" className="bg-gradient-to-br from-warning/10 to-card" onClick={() => { setActiveTab("pendientes"); setPage(1); }} active={activeTab === "pendientes"} />
            <MetricCard tone="success" icon={<CalendarCheck />} label="Reservas generadas" value={stats?.convertidos ?? 0} detail={`${stats?.conversionRate ?? 0}% conversión`} className="bg-gradient-to-br from-success/10 to-card" onClick={() => { setActiveTab("reservas_generadas"); setPage(1); }} active={activeTab === "reservas_generadas"} />
            <MetricCard tone="danger" icon={<AlertTriangle />} label="Incidencias" value={stats?.incidencias ?? 0} detail="Requieren atención" className="bg-gradient-to-br from-danger/10 to-card" onClick={() => { setActiveTab("incidencias"); setPage(1); }} active={activeTab === "incidencias"} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <MetricCard compact tone="brand" icon={<TrendingUp />} label="Total cupones" value={stats?.total ?? 0} />
            <MetricCard compact tone="success" icon={<Banknote />} label="Canjeados" value={stats?.canjeados ?? 0} />
            <MetricCard compact tone="warning" icon={<Zap />} label="% Conversión" value={`${stats?.conversionRate ?? 0}%`} />
          </div>

          {/* ── VISTAS ───────────────────────────────────────────────────────── */}
          <SegmentedTabs<Tab>
            label="Vista del pipeline"
            value={activeTab}
            onChange={(v) => { setActiveTab(v); setPage(1); }}
            options={tabs.map((tab) => ({ value: tab.id, label: tab.label, count: tab.count ?? null }))}
          />

          {/* ── CONTENIDO POR TAB ────────────────────────────────────────────── */}
          {activeTab === "liquidaciones" ? (
            <LiquidacionesTab />
          ) : (
            <>
              {/* Filtros */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1 sm:max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input aria-label="Buscar cupones" placeholder="Buscar por nombre, email, código..."
                    value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9" />
                </div>
                <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(1); }}>
                  <SelectTrigger aria-label="Filtrar por proveedor" className="w-full sm:w-52">
                    <Filter className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos los proveedores</SelectItem>
                    {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Listado: tabla desde 768 px, tarjetas en móvil */}
              {couponsQuery.isLoading ? (
                <PanelLoading />
              ) : couponsQuery.error ? (
                <PanelError error={couponsQuery.error} onRetry={() => void couponsQuery.refetch()} title="No se han podido cargar los cupones" />
              ) : coupons.length === 0 ? (
                <PanelEmpty
                  icon={<Ticket />}
                  title="No hay cupones en esta vista"
                  description={search || providerFilter !== "all" ? "Prueba con otra búsqueda o quita el filtro de proveedor." : "Cuando llegue un cupón de una plataforma aparecerá aquí, o dalo de alta a mano."}
                >
                  <Button size="sm" onClick={() => setManualOpen(true)}><Plus className="mr-1 h-4 w-4" /> Alta manual</Button>
                </PanelEmpty>
              ) : (
                <PanelDataList rows={coupons} columns={columns} rowKey={(c) => c.id} caption="Cupones del pipeline" />
              )}

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} · {couponsQuery.data?.total ?? 0} cupones
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Detalle */}
      {detailCoupon && (
        <DetailModal
          coupon={detailCoupon}
          onClose={() => setDetailCoupon(null)}
          onConvert={(c) => setConvertCoupon(c)}
          onRedeem={(c) => setRedeemCoupon(c)}
          onPostpone={(c) => { setPostponeCoupon(c); setPostponeNotes(""); }}
          onIncidence={(c) => { setIncidenceCoupon(c); setIncidenceNotes(""); }}
        />
      )}

      {/* Convertir en reserva */}
      {convertCoupon && (
        <ConvertModal
          coupon={convertCoupon}
          convertForm={convertForm}
          setConvertForm={setConvertForm}
          convertMutation={convertMutation}
          onClose={() => { setConvertCoupon(null); setConvertForm({ reservationDate: "", participants: 1, platformProductId: undefined, selectedPlatformId: undefined }); }}
        />
      )}

      {/* Posponer */}
      <Dialog open={!!postponeCoupon} onOpenChange={() => setPostponeCoupon(null)}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="w-5 h-5 text-warning" />
              Posponer cupón
            </DialogTitle>
          </DialogHeader>
          {postponeCoupon && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-sm text-warning">
                Se enviará un email automático al cliente: "Actualmente no hay disponibilidad para la fecha solicitada. Quedará en lista de espera."
              </div>
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-foreground/60">Cliente: <span className="text-foreground">{postponeCoupon.customerName}</span></p>
                <p className="text-foreground/60">Cupón: <code className="text-primary">{postponeCoupon.couponCode}</code></p>
              </div>
              <div>
                <Label className="text-foreground/70 text-sm">Notas internas (opcional)</Label>
                <Textarea value={postponeNotes} onChange={(e) => setPostponeNotes(e.target.value)}
                  placeholder="Motivo del aplazamiento..." className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostponeCoupon(null)} className="border-border text-foreground/70">Cancelar</Button>
            <Button className="bg-warning hover:bg-warning/90 text-primary-foreground"
              disabled={postponeMutation.isPending}
              onClick={() => {
                if (!postponeCoupon) return;
                postponeMutation.mutate({ id: postponeCoupon.id, notes: postponeNotes || undefined });
              }}>
              {postponeMutation.isPending ? "Posponiendo..." : "Posponer y enviar email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Incidencia */}
      <Dialog open={!!incidenceCoupon} onOpenChange={() => setIncidenceCoupon(null)}>
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-danger" />
              Marcar incidencia
            </DialogTitle>
          </DialogHeader>
          {incidenceCoupon && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <p className="text-foreground/60">Cliente: <span className="text-foreground">{incidenceCoupon.customerName}</span></p>
                <p className="text-foreground/60">Cupón: <code className="text-primary">{incidenceCoupon.couponCode}</code></p>
              </div>
              <div>
                <Label className="text-foreground/70 text-sm">Descripción de la incidencia</Label>
                <Textarea value={incidenceNotes} onChange={(e) => setIncidenceNotes(e.target.value)}
                  placeholder="Describe el problema..." className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidenceCoupon(null)} className="border-border text-foreground/70">Cancelar</Button>
            <Button variant="destructive" 
              disabled={incidenceMutation.isPending}
              onClick={() => {
                if (!incidenceCoupon) return;
                incidenceMutation.mutate({ id: incidenceCoupon.id, notes: incidenceNotes || undefined });
              }}>
              {incidenceMutation.isPending ? "Guardando..." : "Marcar incidencia"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Marcar como canjeado */}
      {redeemCoupon && (
        <RedeemModal
          coupon={redeemCoupon}
          onClose={() => setRedeemCoupon(null)}
          onConfirm={(data) => markAsRedeemedMutation.mutate({ id: redeemCoupon.id, ...data })}
          isPending={markAsRedeemedMutation.isPending}
        />
      )}

      {/* Alta manual */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Alta manual de cupón
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Proveedor *</Label>
                <Select value={manualForm.provider} onValueChange={(v) => setManualForm(f => ({ ...f, provider: v }))}>
                  <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Canal *</Label>
                <Select value={manualForm.channelEntry} onValueChange={(v) => setManualForm(f => ({ ...f, channelEntry: v as typeof manualForm.channelEntry }))}>
                  <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {["web", "email", "whatsapp", "telefono", "presencial", "manual"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Nombre cliente *</Label>
              <Input value={manualForm.customerName} onChange={(e) => setManualForm(f => ({ ...f, customerName: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Email *</Label>
                <Input type="email" value={manualForm.email} onChange={(e) => setManualForm(f => ({ ...f, email: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Teléfono</Label>
                <Input value={manualForm.phone} onChange={(e) => setManualForm(f => ({ ...f, phone: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Código cupón *</Label>
                <Input value={manualForm.couponCode} onChange={(e) => setManualForm(f => ({ ...f, couponCode: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Código seguridad</Label>
                <Input value={manualForm.securityCode} onChange={(e) => setManualForm(f => ({ ...f, securityCode: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Fecha solicitada</Label>
                <Input type="date" value={manualForm.requestedDate} onChange={(e) => setManualForm(f => ({ ...f, requestedDate: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Participantes</Label>
                <Input type="number" min={1} value={manualForm.participants} onChange={(e) => setManualForm(f => ({ ...f, participants: parseInt(e.target.value) || 1 }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Adjunto cupón (imagen o PDF)</Label>
              <div className="mt-1">
                {manualForm.attachmentUrl ? (
                  <div className="flex items-center gap-2 p-2 rounded bg-success/10 border border-success/20">
                    <CheckCircle className="w-4 h-4 text-success shrink-0" />
                    <span className="text-success text-xs overflow-hidden text-ellipsis whitespace-nowrap flex-1">{manualAttachName}</span>
                    <button type="button" onClick={() => { setManualForm(f => ({ ...f, attachmentUrl: "" })); setManualAttachName(""); setManualAttachError(""); }} className="text-muted-foreground hover:text-foreground/70">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 cursor-pointer p-2 rounded border border-dashed border-border hover:border-primary/50 transition-colors">
                    <Upload className="w-4 h-4 text-muted-foreground" />
                    <span className="text-muted-foreground text-xs">{manualUploadMutation.isPending ? "Subiendo..." : "Seleccionar archivo (JPG, PNG, PDF, máx 10MB)"}</span>
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setManualAttachError("");
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const dataUrl = reader.result as string;
                            const base64Data = dataUrl.split(",")[1];
                            const result = await manualUploadMutation.mutateAsync({ filename: file.name, mimeType: file.type, base64Data });
                            setManualForm(f => ({ ...f, attachmentUrl: result.url }));
                            setManualAttachName(file.name);
                          } catch (err: unknown) {
                            setManualAttachError("Error al subir: " + (err instanceof Error ? err.message : "Error desconocido"));
                            e.target.value = "";
                          }
                        };
                        reader.readAsDataURL(file);
                      }} />
                  </label>
                )}
                {manualAttachError && <p className="text-danger text-xs mt-1">{manualAttachError}</p>}
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Notas internas</Label>
              <Textarea value={manualForm.notes} onChange={(e) => setManualForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} className="border-border text-foreground/70">Cancelar</Button>
            <Button 
              disabled={!manualForm.customerName || !manualForm.email || !manualForm.couponCode || createManualMutation.isPending || manualUploadMutation.isPending}
              onClick={() => createManualMutation.mutate({ ...manualForm, attachmentUrl: manualForm.attachmentUrl || undefined })}>
              {createManualMutation.isPending ? "Registrando..." : "Registrar cupón"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmación de borrado */}
      {deleteCoupon && (
        <Dialog open onOpenChange={() => setDeleteCoupon(null)}>
          <DialogContent className="bg-background border-border text-foreground max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-danger">
                <Trash2 className="w-5 h-5" />
                Eliminar cupón
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-danger/10 border border-danger/20">
                <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
                <p className="text-sm text-danger">
                  Esta acción es <strong>permanente e irreversible</strong>. El cupón será eliminado completamente del sistema.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-20">Cliente</span>
                  <span className="text-foreground text-sm font-medium">{deleteCoupon.customerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-20">Código</span>
                  <code className="text-primary font-mono text-sm">{deleteCoupon.couponCode}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-20">Proveedor</span>
                  <ProviderBadge provider={deleteCoupon.provider} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-20">Estado</span>
                  <OpBadge status={deleteCoupon.statusOperational} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteCoupon(null)}
                className="border-border text-foreground/70 hover:bg-muted">
                Cancelar
              </Button>
              <Button
                className="bg-danger hover:bg-danger/90 text-primary-foreground"
                disabled={deleteRedemptionMutation.isPending}
                onClick={() => deleteRedemptionMutation.mutate({ id: deleteCoupon.id })}>
                {deleteRedemptionMutation.isPending ? "Eliminando..." : "Sí, eliminar cupón"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </AdminLayout>
  );
}

// ─── REDEEM MODAL ────────────────────────────────────────────────────────────
function RedeemModal({ coupon, onClose, onConfirm, isPending }: {
  coupon: Coupon;
  onClose: () => void;
  onConfirm: (data: { notes?: string; justificantBase64?: string; justificantFileName?: string; justificantMimeType?: string; platformProductId?: number; reservationDate?: string; participants: number }) => void;
  isPending: boolean;
}) {
  const [notes, setNotes] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const [reservationDate, setReservationDate] = React.useState(coupon.requestedDate ?? "");
  const [participants, setParticipants] = React.useState(coupon.participants ?? 1);
  const [selectedPlatformId, setSelectedPlatformId] = React.useState<number | undefined>();
  const [platformProductId, setPlatformProductId] = React.useState<number | undefined>();

  const platformsQuery = trpc.ticketing.listPlatforms.useQuery();
  const platforms = platformsQuery.data ?? [];
  const productsQuery = trpc.ticketing.listPlatformProducts.useQuery(
    { platformId: selectedPlatformId! },
    { enabled: !!selectedPlatformId }
  );
  const products = (productsQuery.data ?? []).filter((p: { active: boolean }) => p.active);
  const selectedProduct = products.find((p: { id: number }) => p.id === platformProductId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setFilePreview(ev.target?.result as string);
      reader.readAsDataURL(f);
    } else {
      setFilePreview(null);
    }
  };

  const handleConfirm = async () => {
    const base = { notes: notes || undefined, platformProductId, reservationDate: reservationDate || undefined, participants };
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        onConfirm({ ...base, justificantBase64: base64, justificantFileName: file.name, justificantMimeType: file.type });
      };
      reader.readAsDataURL(file);
    } else {
      onConfirm(base);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-background border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-success" />
            Marcar como canjeado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-success/10 border border-success/20 text-sm text-success">
            El cupón pasará a <strong>Canjeado</strong> y se creará automáticamente una reserva en el CRM.
          </div>
          <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
            <p className="text-foreground/60">Cliente: <span className="text-foreground">{coupon.customerName}</span></p>
            <p className="text-foreground/60">Cupón: <code className="text-primary">{coupon.couponCode}</code> · <ProviderBadge provider={coupon.provider} /></p>
          </div>

          {/* Plataforma */}
          <div>
            <Label className="text-foreground/70 text-sm">Plataforma *</Label>
            <Select value={selectedPlatformId?.toString() ?? ""} onValueChange={(v) => { setSelectedPlatformId(parseInt(v)); setPlatformProductId(undefined); }}>
              <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1">
                <SelectValue placeholder="Selecciona la plataforma del cupón" />
              </SelectTrigger>
              <SelectContent className="bg-card border-border">
                {platforms.map((pl: { id: number; name: string }) => (
                  <SelectItem key={pl.id} value={pl.id.toString()}>{pl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Producto */}
          {selectedPlatformId && (
            <div>
              <Label className="text-foreground/70 text-sm">Producto *</Label>
              {productsQuery.isPending ? (
                <p className="text-muted-foreground text-sm mt-2">Cargando...</p>
              ) : products.length === 0 ? (
                <p className="text-warning text-sm mt-2">No hay productos activos. Configúralos en Plataformas.</p>
              ) : (
                <Select value={platformProductId?.toString() ?? ""} onValueChange={(v) => setPlatformProductId(parseInt(v))}>
                  <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1">
                    <SelectValue placeholder="Selecciona el producto" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {products.map((p: { id: number; externalProductName?: string | null; pvpPrice?: string | null }) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.externalProductName ?? `Producto #${p.id}`}
                        {p.pvpPrice && <span className="ml-2 text-muted-foreground text-xs">PVP: {p.pvpPrice}€</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {selectedProduct && (
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-success/10 border border-success/20 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">PVP</p>
                <p className="text-success font-bold">{selectedProduct.pvpPrice ?? "—"}€</p>
              </div>
              <div className="p-2.5 rounded-lg bg-info/10 border border-info/20 text-center">
                <p className="text-xs text-muted-foreground mb-0.5">Precio neto</p>
                <p className="text-info font-bold">{selectedProduct.netPrice ?? "—"}€</p>
              </div>
            </div>
          )}

          {/* Fecha y participantes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-foreground/70 text-sm">Fecha de reserva *</Label>
              <Input type="date" value={reservationDate} onChange={(e) => setReservationDate(e.target.value)}
                className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-sm">Participantes</Label>
              <Input type="number" min={1} value={participants} onChange={(e) => setParticipants(parseInt(e.target.value) || 1)}
                className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
          </div>

          {/* Comprobante */}
          <div>
            <Label className="text-foreground/70 text-sm mb-2 block">Comprobante de canje (opcional)</Label>
            <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-border hover:border-success/40 cursor-pointer transition-colors bg-muted/50">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{file ? file.name : "Arrastra o haz clic para subir"}</span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileChange} />
            </label>
            {file && (
              <div className="mt-2 flex items-center justify-between p-2 rounded-lg bg-muted/50 text-xs">
                <span className="text-foreground/70 overflow-hidden text-ellipsis whitespace-nowrap">{file.name}</span>
                <button onClick={() => { setFile(null); setFilePreview(null); }} className="text-muted-foreground hover:text-danger ml-2"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            {filePreview && <img src={filePreview} alt="Preview" className="mt-2 rounded-lg max-h-32 object-contain w-full" />}
          </div>

          <div>
            <Label className="text-foreground/70 text-sm">Notas internas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones del canje..." className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-border text-foreground/70">Cancelar</Button>
          <Button className="bg-success hover:bg-success/90 text-primary-foreground"
            disabled={isPending || !reservationDate || !platformProductId}
            onClick={handleConfirm}>
            {isPending ? "Guardando..." : "✅ Confirmar canje y crear reserva"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── LIQUIDACIÓN CARD (acordeón) ─────────────────────────────────────────────
function SettlementCard({ s }: { s: {
  id: number; platformId: number; platformName?: string | null; periodLabel: string;
  periodFrom?: string | null; periodTo?: string | null; totalCoupons: number;
  totalAmount: string | null; netTotal?: string | null; status: string;
  invoiceRef?: string | null; notes?: string | null; emittedAt?: Date | null; paidAt?: Date | null;
}}) {
  const [open, setOpen] = React.useState(false);
  const couponsQuery = trpc.ticketing.getSettlementCoupons.useQuery(
    { settlementId: s.id },
    { enabled: open }
  );
  const coupons = couponsQuery.data ?? [];

  const statusBadge = s.status === "pagada"
    ? <StatusBadge tone="success" icon={<CheckCircle />}>Pagada</StatusBadge>
    : s.status === "emitida"
    ? <StatusBadge tone="info" icon={<Zap />}>Emitida</StatusBadge>
    : <StatusBadge tone="warning" icon={<Clock />}>Pendiente</StatusBadge>;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Cabecera siempre visible */}
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Banknote className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-foreground">
              {s.platformName ?? `Plataforma #${s.platformId}`}
              <span className="ml-2 font-normal text-muted-foreground">·</span>
              <span className="ml-2 font-normal text-muted-foreground">{s.periodLabel}</span>
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="text-xs text-muted-foreground">{s.totalCoupons} cupón{s.totalCoupons !== 1 ? "es" : ""}</span>
              <span className="text-xs font-semibold text-foreground">PVP: {s.totalAmount} €</span>
              {s.netTotal && <span className="text-xs font-semibold text-info">Neto: {s.netTotal} €</span>}
              {s.invoiceRef && <span className="text-xs text-muted-foreground">Ref: {s.invoiceRef}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {statusBadge}
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        </div>
      </button>

      {/* Detalle expandido */}
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3 sm:px-5">
          {couponsQuery.isPending ? (
            <PanelLoading label="Cargando cupones…" />
          ) : coupons.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay cupones vinculados a esta liquidación.</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[30rem] space-y-1">
                {/* Cabecera columnas */}
                <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-3 pb-1 text-xs font-medium text-muted-foreground">
                  <span>Cliente</span>
                  <span>Código cupón</span>
                  <span>Fecha canje</span>
                  <span className="text-right">PVP</span>
                  <span className="text-right">Neto</span>
                </div>
                {coupons.map((c) => (
                  <div key={c.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40">
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm text-foreground">{c.customerName}</span>
                    <span className="font-mono text-sm text-primary">{c.couponCode}</span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                    </span>
                    <span className="whitespace-nowrap text-right text-xs text-foreground">{c.pvpPrice ? `${c.pvpPrice} €` : "—"}</span>
                    <span className="whitespace-nowrap text-right text-xs text-info">{c.netPrice ? `${c.netPrice} €` : "—"}</span>
                  </div>
                ))}
                {/* Totales */}
                <div className="mt-1 grid grid-cols-[1fr_1fr_auto_auto_auto] items-center gap-3 border-t border-border px-3 pt-2">
                  <span className="col-span-3 text-xs font-semibold text-muted-foreground">Total ({coupons.length} cupones)</span>
                  <span className="text-right text-xs font-bold text-foreground">{s.totalAmount} €</span>
                  <span className="text-right text-xs font-bold text-info">{s.netTotal ?? "—"} €</span>
                </div>
              </div>
            </div>
          )}
          {s.notes && (
            <p className="mt-3 border-t border-border pt-3 text-xs italic text-muted-foreground">{s.notes}</p>
          )}
          {(s.paidAt || s.emittedAt) && (
            <div className="mt-3 flex gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
              {s.emittedAt && <span>Emitida: {new Date(s.emittedAt).toLocaleDateString("es-ES")}</span>}
              {s.paidAt && <span>Pagada: {new Date(s.paidAt).toLocaleDateString("es-ES")}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── LIQUIDACIONES TAB ────────────────────────────────────────────────────────
function LiquidacionesTab() {
  const settlementsQuery = trpc.ticketing.listSettlements.useQuery({});
  const settlements = settlementsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-foreground">Liquidaciones de plataformas</h2>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/marketing/plataformas">Gestionar plataformas <ChevronRight className="ml-1 h-4 w-4" /></Link>
        </Button>
      </div>
      {settlementsQuery.isLoading ? (
        <PanelLoading />
      ) : settlementsQuery.error ? (
        <PanelError error={settlementsQuery.error} onRetry={() => void settlementsQuery.refetch()} title="No se han podido cargar las liquidaciones" />
      ) : settlements.length === 0 ? (
        <PanelEmpty icon={<Banknote />} title="No hay liquidaciones registradas" description="Crea plataformas y genera liquidaciones desde el módulo de Plataformas.">
          <Button asChild size="sm" variant="outline"><Link href="/admin/marketing/plataformas">Ir a Plataformas</Link></Button>
        </PanelEmpty>
      ) : (
        <div className="space-y-2">
          {settlements.map((s) => <SettlementCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}
