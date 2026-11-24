/**
 * CuponesManager — Pipeline de Cupones & Ticketing
 * v23.1: Diseño oscuro tipo CRM · Pipeline Recibido→Pendiente→Reserva generada
 * Estados financieros: Pendiente canjear · Canjeado · Incidencia
 * Proveedores fijos: Groupon, Smartbox, CheckYeti, Atrapalo, Jumping, Alpine Resort, Civitatis
 */
import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { PanelPageHeader } from "@/components/admin/PanelUi";
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

const PROVIDER_COLORS: Record<string, string> = {
  Groupon: "bg-success/15 text-success border-success/30",
  Smartbox: "bg-info/15 text-info border-info/30",
  CheckYeti: "bg-info/15 text-info border-info/30",
  Atrapalo: "bg-warning/15 text-warning border-warning/30",
  Jumping: "bg-warning/15 text-warning border-warning/30",
  "Alpine Resort": "bg-info/15 text-info border-info/30",
  Civitatis: "bg-primary/15 text-primary border-primary/30",
};

// ─── BADGES ───────────────────────────────────────────────────────────────────
function ProviderBadge({ provider }: { provider: string }) {
  const cls = PROVIDER_COLORS[provider] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {provider}
    </span>
  );
}

function OpBadge({ status }: { status: StatusOp }) {
  const map: Record<StatusOp, { label: string; cls: string; icon: React.ReactNode }> = {
    recibido: { label: "Recibido", cls: "bg-info/15 text-info border-info/30", icon: <Ticket className="w-3 h-3" /> },
    pendiente: { label: "Pendiente", cls: "bg-warning/15 text-warning border-warning/30", icon: <Clock className="w-3 h-3" /> },
    reserva_generada: { label: "Reserva generada", cls: "bg-success/15 text-success border-success/30", icon: <CheckCircle className="w-3 h-3" /> },
  };
  const { label, cls, icon } = map[status] ?? map.recibido;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {icon}{label}
    </span>
  );
}

function FinBadge({ status }: { status: StatusFin }) {
  const map: Record<StatusFin, { label: string; cls: string }> = {
    pendiente_canjear: { label: "Pendiente canjear", cls: "bg-muted text-muted-foreground border-border" },
    canjeado: { label: "Canjeado", cls: "bg-success/15 text-success border-success/30" },
    incidencia: { label: "Incidencia", cls: "bg-danger/15 text-danger border-danger/30" },
  };
  const { label, cls } = map[status] ?? map.pendiente_canjear;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {label}
    </span>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, gradient, icon }: {
  label: string; value: number | string; sub?: string; gradient: string; icon: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-border/50 p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
          <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg bg-muted">{icon}</div>
      </div>
    </div>
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

  return (
    <AdminLayout>
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <PanelPageHeader
            className="mb-0"
            icon={<Ticket />}
            title="Pipeline de Cupones"
            description="Recibido → Pendiente → Reserva generada · Trazabilidad completa por proveedor"
            actions={<>
              <Button variant="outline" size="sm"
                className="border-border bg-muted/50 text-foreground/70 hover:bg-muted"
                onClick={() => window.location.href = "/admin/marketing/plataformas"}>
                <Settings className="w-4 h-4 mr-1" /> Plataformas
              </Button>
              <Button variant="outline" size="sm"
                className="border-border bg-muted/50 text-foreground/70 hover:bg-muted"
                onClick={() => { utils.ticketing.listCoupons.invalidate(); utils.ticketing.getDashboardStats.invalidate(); }}>
                <RefreshCw className="w-4 h-4 mr-1" /> Actualizar
              </Button>
              <Button size="sm" 
                onClick={() => setManualOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Alta manual
              </Button>
            </>}
          />

          {/* ── DASHBOARD CARDS ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Cupones recibidos" value={stats?.recibidos ?? 0} sub="Sin procesar"
              gradient="bg-gradient-to-br from-info/40 to-info/20"
              icon={<Ticket className="w-5 h-5 text-info" />} />
            <StatCard label="Pendientes" value={stats?.pendientes ?? 0} sub="Sin disponibilidad"
              gradient="bg-gradient-to-br from-warning/40 to-warning/20"
              icon={<Clock className="w-5 h-5 text-warning" />} />
            <StatCard label="Reservas generadas" value={stats?.convertidos ?? 0} sub={`${stats?.conversionRate ?? 0}% conversión`}
              gradient="bg-gradient-to-br from-success/40 to-success/20"
              icon={<CalendarCheck className="w-5 h-5 text-success" />} />
            <StatCard label="Incidencias" value={stats?.incidencias ?? 0} sub="Requieren atención"
              gradient="bg-gradient-to-br from-danger/40 to-danger/20"
              icon={<AlertTriangle className="w-5 h-5 text-danger" />} />
          </div>

          {/* ── MÉTRICAS SECUNDARIAS ─────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total cupones", value: stats?.total ?? 0, icon: <TrendingUp className="w-4 h-4 text-primary" />, bg: "bg-primary/10" },
              { label: "Canjeados", value: stats?.canjeados ?? 0, icon: <Banknote className="w-4 h-4 text-success" />, bg: "bg-success/10" },
              { label: "% Conversión", value: `${stats?.conversionRate ?? 0}%`, icon: <Zap className="w-4 h-4 text-warning" />, bg: "bg-warning/10" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-border/50 bg-muted/50 p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${m.bg}`}>{m.icon}</div>
                <div>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                  <p className="text-lg font-bold text-foreground">{m.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── TABS ─────────────────────────────────────────────────────────── */}
          <div className="flex gap-1 border-b border-border/50">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setPage(1); }}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? "bg-muted text-foreground border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground/80 hover:bg-muted"
                }`}>
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-primary/30 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── CONTENIDO POR TAB ────────────────────────────────────────────── */}
          {activeTab === "liquidaciones" ? (
            <LiquidacionesTab />
          ) : (
            <>
              {/* Filtros */}
              <div className="flex gap-3 items-center">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input placeholder="Buscar por nombre, email, código..."
                    value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground focus:border-primary/50" />
                </div>
                <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-48 bg-muted/50 border-border text-foreground">
                    <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue placeholder="Proveedor" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="all">Todos los proveedores</SelectItem>
                    {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Tabla */}
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/50">
                      {["Cliente", "Código", "Proveedor", "Estado op.", "Estado fin.", "Fecha", ""].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-muted-foreground font-medium text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {couponsQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="h-4 bg-muted/50 rounded animate-pulse" /></td>
                          ))}
                        </tr>
                      ))
                    ) : coupons.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No hay cupones en esta vista</td></tr>
                    ) : coupons.map((c) => (
                      <tr key={c.id} className={`border-b border-border/50 hover:bg-muted transition-colors ${c.duplicateFlag ? "bg-warning/5" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                              {c.customerName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-foreground font-medium text-sm">{c.customerName}</p>
                              <p className="text-muted-foreground text-xs">{c.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {c.duplicateFlag && <AlertTriangle className="w-3 h-3 text-warning shrink-0" aria-label="Posible duplicado" />}
                            <code className="text-primary text-xs bg-primary/10 px-2 py-0.5 rounded">{c.couponCode}</code>
                          </div>
                        </td>
                        <td className="px-4 py-3"><ProviderBadge provider={c.provider} /></td>
                        <td className="px-4 py-3"><OpBadge status={c.statusOperational} /></td>
                        <td className="px-4 py-3"><FinBadge status={c.statusFinancial} /></td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {new Date(c.createdAt).toLocaleDateString("es-ES")}
                          {c.requestedDate && <div className="text-muted-foreground">{c.requestedDate}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setDetailCoupon(c)}
                              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" aria-label="Ver detalle">
                              <Eye className="w-4 h-4" />
                            </button>
                            {c.statusOperational === "recibido" && (
                              <button onClick={() => { setPostponeCoupon(c); setPostponeNotes(""); }}
                                className="p-1.5 rounded-lg hover:bg-warning/20 text-warning/60 hover:text-warning transition-colors" aria-label="Posponer">
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusFinancial === "pendiente_canjear" && (
                              <button onClick={() => setRedeemCoupon(c)}
                                className="p-1.5 rounded-lg hover:bg-success/20 text-success/60 hover:text-success transition-colors" aria-label="Marcar como canjeado">
                                <BadgeCheck className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusFinancial !== "incidencia" && (
                              <button onClick={() => { setIncidenceCoupon(c); setIncidenceNotes(""); }}
                                className="p-1.5 rounded-lg hover:bg-danger/20 text-danger/60 hover:text-danger transition-colors" aria-label="Marcar incidencia">
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusOperational === "reserva_generada" && c.reservationId && (
                              <button
                                onClick={() => regenerateMutation.mutate({ reservationId: c.reservationId! })}
                                disabled={regenerateMutation.isPending}
                                className="p-1.5 rounded-lg hover:bg-info/20 text-info/60 hover:text-info transition-colors disabled:opacity-40" aria-label="Regenerar operación y reenviar email">
                                <Zap className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => setDeleteCoupon(c)}
                              className="p-1.5 rounded-lg hover:bg-danger/30 text-danger/50 hover:text-danger transition-colors" aria-label="Eliminar cupón">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginación */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Página {page} de {totalPages} · {couponsQuery.data?.total ?? 0} cupones
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                      className="border-border bg-muted/50 text-foreground/70">Anterior</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                      className="border-border bg-muted/50 text-foreground/70">Siguiente</Button>
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
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-success/15 text-success border-success/30"><CheckCircle className="w-3 h-3" /> Pagada</span>
    : s.status === "emitida"
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-info/15 text-info border-info/30"><Zap className="w-3 h-3" /> Emitida</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-warning/15 text-warning border-warning/30"><Clock className="w-3 h-3" /> Pendiente</span>;

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
      {/* Cabecera siempre visible */}
      <button
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
            <Banknote className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-foreground font-semibold text-sm overflow-hidden text-ellipsis whitespace-nowrap">
              {s.platformName ?? `Plataforma #${s.platformId}`}
              <span className="ml-2 text-muted-foreground font-normal">·</span>
              <span className="ml-2 text-muted-foreground font-normal">{s.periodLabel}</span>
            </p>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <span className="text-xs text-muted-foreground">{s.totalCoupons} cupón{s.totalCoupons !== 1 ? "es" : ""}</span>
              <span className="text-xs font-semibold text-foreground/70">PVP: {s.totalAmount} €</span>
              {s.netTotal && <span className="text-xs font-semibold text-info">Neto: {s.netTotal} €</span>}
              {s.invoiceRef && <span className="text-xs text-muted-foreground">Ref: {s.invoiceRef}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          {statusBadge}
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
      </button>

      {/* Detalle expandido */}
      {open && (
        <div className="border-t border-border/50 px-5 pb-4 pt-3">
          {couponsQuery.isPending ? (
            <p className="text-muted-foreground text-sm py-4 text-center">Cargando cupones...</p>
          ) : coupons.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">No hay cupones vinculados a esta liquidación.</p>
          ) : (
            <div className="space-y-1">
              {/* Cabecera columnas */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                <span>Cliente</span>
                <span>Código cupón</span>
                <span>Fecha canje</span>
                <span className="text-right">PVP</span>
                <span className="text-right">Neto</span>
              </div>
              {coupons.map((c) => (
                <div key={c.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 items-center px-3 py-2 rounded-lg hover:bg-muted transition-colors">
                  <span className="text-sm text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{c.customerName}</span>
                  <span className="text-sm font-mono text-primary">{c.couponCode}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </span>
                  <span className="text-xs text-foreground/70 text-right whitespace-nowrap">{c.pvpPrice ? `${c.pvpPrice} €` : "—"}</span>
                  <span className="text-xs text-info text-right whitespace-nowrap">{c.netPrice ? `${c.netPrice} €` : "—"}</span>
                </div>
              ))}
              {/* Totales */}
              <div className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-3 items-center px-3 pt-2 mt-1 border-t border-border/50">
                <span className="text-xs font-semibold text-muted-foreground col-span-3">Total ({coupons.length} cupones)</span>
                <span className="text-xs font-bold text-foreground text-right">{s.totalAmount} €</span>
                <span className="text-xs font-bold text-info text-right">{s.netTotal ?? "—"} €</span>
              </div>
            </div>
          )}
          {s.notes && (
            <p className="mt-3 text-xs text-muted-foreground italic border-t border-border/50 pt-3">{s.notes}</p>
          )}
          {(s.paidAt || s.emittedAt) && (
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground border-t border-border/50 pt-3">
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Liquidaciones de plataformas</h2>
        <Button variant="outline" size="sm"
          className="border-border bg-muted/50 text-foreground/70 hover:bg-muted"
          onClick={() => window.location.href = "/admin/marketing/plataformas"}>
          Gestionar plataformas <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
      {settlements.length === 0 ? (
        <div className="rounded-xl border border-border/50 p-12 text-center text-muted-foreground">
          No hay liquidaciones registradas. Crea plataformas y genera liquidaciones desde el módulo de Plataformas.
        </div>
      ) : (
        <div className="space-y-2">
          {settlements.map((s) => <SettlementCard key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}
