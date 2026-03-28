/**
 * CuponesManager — Pipeline de Cupones & Ticketing
 * v23.1: Diseño oscuro tipo CRM · Pipeline Recibido→Pendiente→Reserva generada
 * Estados financieros: Pendiente canjear · Canjeado · Incidencia
 * Proveedores fijos: Groupon, Smartbox, CheckYeti, Atrapalo, Jumping, Alpine Resort, Civitatis
 */
import React, { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
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
  Groupon: "bg-green-500/15 text-green-400 border-green-500/30",
  Smartbox: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  CheckYeti: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  Atrapalo: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  Jumping: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  "Alpine Resort": "bg-sky-500/15 text-sky-400 border-sky-500/30",
  Civitatis: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

// ─── BADGES ───────────────────────────────────────────────────────────────────
function ProviderBadge({ provider }: { provider: string }) {
  const cls = PROVIDER_COLORS[provider] ?? "bg-slate-500/15 text-slate-400 border-slate-500/30";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {provider}
    </span>
  );
}

function OpBadge({ status }: { status: StatusOp }) {
  const map: Record<StatusOp, { label: string; cls: string; icon: React.ReactNode }> = {
    recibido: { label: "Recibido", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: <Ticket className="w-3 h-3" /> },
    pendiente: { label: "Pendiente", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: <Clock className="w-3 h-3" /> },
    reserva_generada: { label: "Reserva generada", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: <CheckCircle className="w-3 h-3" /> },
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
    pendiente_canjear: { label: "Pendiente canjear", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    canjeado: { label: "Canjeado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    incidencia: { label: "Incidencia", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
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
    <div className={`relative overflow-hidden rounded-xl border border-white/5 p-5 ${gradient}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-white/50 uppercase tracking-wider font-medium">{label}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
        </div>
        <div className="p-2 rounded-lg bg-white/10">{icon}</div>
      </div>
    </div>
  );
}

// ─── DETAIL MODAL ─────────────────────────────────────────────────────────────
function DetailModal({ coupon, onClose, onConvert, onPostpone, onIncidence }: {
  coupon: Coupon;
  onClose: () => void;
  onConvert: (c: Coupon) => void;
  onPostpone: (c: Coupon) => void;
  onIncidence: (c: Coupon) => void;
}) {
  const rerunOcr = trpc.ticketing.rerunOcr.useMutation({
    onSuccess: (res) => toast.success(`OCR completado: ${res.score}% (${res.status})`),
    onError: () => toast.error("Error al ejecutar OCR"),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-violet-400" />
            Detalle del cupón #{coupon.id}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Cliente */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
            <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 font-bold shrink-0">
              {coupon.customerName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-white">{coupon.customerName}</p>
              <p className="text-sm text-white/50">{coupon.email}</p>
              {coupon.phone && <p className="text-sm text-white/50">{coupon.phone}</p>}
            </div>
          </div>
          {/* Info cupón */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Código cupón</p>
              <code className="text-violet-300 font-mono">{coupon.couponCode}</code>
              {coupon.duplicateFlag && <span className="ml-2 text-xs text-amber-400">⚠ Posible duplicado</span>}
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Proveedor</p>
              <ProviderBadge provider={coupon.provider} />
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Estado operacional</p>
              <OpBadge status={coupon.statusOperational} />
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Estado financiero</p>
              <FinBadge status={coupon.statusFinancial} />
            </div>
            {coupon.requestedDate && (
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-white/40 text-xs mb-1">Fecha solicitada</p>
                <p className="text-white">{coupon.requestedDate}</p>
              </div>
            )}
            {coupon.station && (
              <div className="p-3 rounded-lg bg-white/5">
                <p className="text-white/40 text-xs mb-1">Estación</p>
                <p className="text-white">{coupon.station}</p>
              </div>
            )}
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Participantes</p>
              <p className="text-white">{coupon.participants ?? 1}</p>
            </div>
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Recibido</p>
              <p className="text-white">{new Date(coupon.createdAt).toLocaleDateString("es-ES")}</p>
            </div>
          </div>
          {/* Notas */}
          {coupon.notes && (
            <div className="p-3 rounded-lg bg-white/5">
              <p className="text-white/40 text-xs mb-1">Notas</p>
              <p className="text-white text-sm">{coupon.notes}</p>
            </div>
          )}
          {/* Reserva generada */}
          {coupon.reservationId && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <p className="text-emerald-400 text-sm flex items-center gap-1">
                <CheckCircle className="w-4 h-4" />
                Reserva #{coupon.reservationId} generada en el CRM
              </p>
            </div>
          )}
          {/* Adjunto + OCR */}
          {coupon.attachmentUrl && (
            <div className="p-3 rounded-lg bg-white/5 space-y-2">
              <p className="text-white/40 text-xs">Adjunto del cupón</p>
              <div className="flex items-center gap-3">
                <a href={coupon.attachmentUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300">
                  <ExternalLink className="w-4 h-4" /> Ver adjunto
                </a>
                {coupon.ocrStatus && (
                  <span className="text-xs text-white/40">OCR: {coupon.ocrConfidenceScore}%</span>
                )}
                {!coupon.ocrStatus && (
                  <Button variant="outline" size="sm" onClick={() => rerunOcr.mutate({ id: coupon.id })}
                    disabled={rerunOcr.isPending}
                    className="h-7 text-xs border-white/10 text-white/60">
                    {rerunOcr.isPending ? "Analizando..." : "Ejecutar OCR"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} className="border-white/10 text-white/70">Cerrar</Button>
          {coupon.statusOperational !== "reserva_generada" && (
            <>
              {coupon.statusOperational === "recibido" && (
                <Button className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => { onClose(); onPostpone(coupon); }}>
                  <Pause className="w-4 h-4 mr-1" /> Posponer
                </Button>
              )}
              {coupon.statusFinancial !== "incidencia" && (
                <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={() => { onClose(); onIncidence(coupon); }}>
                  <AlertTriangle className="w-4 h-4 mr-1" /> Incidencia
                </Button>
              )}
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { onClose(); onConvert(coupon); }}>
                <CalendarCheck className="w-4 h-4 mr-1" /> Convertir en reserva
              </Button>
            </>
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
      <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-emerald-400" />
            Convertir en reserva
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Info cupón */}
          <div className="p-3 rounded-lg bg-white/5 text-sm">
            <p className="text-white/60">Cliente: <span className="text-white font-medium">{coupon.customerName}</span></p>
            <p className="text-white/60 mt-0.5">Cupón: <code className="text-violet-300">{coupon.couponCode}</code> · <ProviderBadge provider={coupon.provider} /></p>
          </div>

          {/* Selector de plataforma */}
          <div>
            <Label className="text-white/70 text-sm">Plataforma *</Label>
            <Select
              value={convertForm.selectedPlatformId?.toString() ?? ""}
              onValueChange={(v) => setConvertForm(f => ({ ...f, selectedPlatformId: parseInt(v), platformProductId: undefined }))}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                <SelectValue placeholder="Selecciona la plataforma del cupón" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a2e] border-white/10">
                {platforms.map((pl: { id: number; name: string }) => (
                  <SelectItem key={pl.id} value={pl.id.toString()}>{pl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Selector de producto de plataforma */}
          {convertForm.selectedPlatformId && (
            <div>
              <Label className="text-white/70 text-sm">Producto *</Label>
              {productsQuery.isPending ? (
                <p className="text-white/40 text-sm mt-2">Cargando productos...</p>
              ) : products.length === 0 ? (
                <p className="text-amber-400 text-sm mt-2">No hay productos activos en esta plataforma. Configúralos en Plataformas.</p>
              ) : (
                <Select
                  value={convertForm.platformProductId?.toString() ?? ""}
                  onValueChange={(v) => setConvertForm(f => ({ ...f, platformProductId: parseInt(v) }))}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                    <SelectValue placeholder="Selecciona el producto" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    {products.map((p: { id: number; externalProductName?: string | null; pvpPrice?: string | null; netPrice?: string | null; expiresAt?: Date | null }) => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        <span>{p.externalProductName ?? `Producto #${p.id}`}</span>
                        {p.pvpPrice && <span className="ml-2 text-white/40 text-xs">PVP: {p.pvpPrice}€</span>}
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
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                <p className="text-xs text-white/40 mb-0.5">PVP</p>
                <p className="text-emerald-400 font-bold">{selectedProduct.pvpPrice ?? "—"}€</p>
              </div>
              <div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                <p className="text-xs text-white/40 mb-0.5">Precio neto</p>
                <p className="text-blue-400 font-bold">{selectedProduct.netPrice ?? "—"}€</p>
              </div>
              <div className="p-2.5 rounded-lg bg-white/5 border border-white/10 text-center">
                <p className="text-xs text-white/40 mb-0.5">Caduca</p>
                <p className="text-white/70 text-sm">
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
              <Label className="text-white/70 text-sm">Fecha de reserva *</Label>
              <Input type="date" value={convertForm.reservationDate}
                onChange={(e) => setConvertForm(f => ({ ...f, reservationDate: e.target.value }))}
                className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-sm">Participantes</Label>
              <Input type="number" min={1} value={convertForm.participants}
                onChange={(e) => setConvertForm(f => ({ ...f, participants: parseInt(e.target.value) || 1 }))}
                className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>

          {/* Resumen de importes */}
          {selectedProduct && convertForm.participants > 0 && (
            <div className="p-3 rounded-lg bg-white/5 border border-white/5 text-sm">
              <div className="flex justify-between text-white/60">
                <span>Importe total (PVP × {convertForm.participants} pax)</span>
                <span className="text-white font-medium">
                  {((parseFloat(selectedProduct.pvpPrice ?? "0")) * convertForm.participants).toFixed(2)}€
                </span>
              </div>
              <div className="flex justify-between text-white/60 mt-1">
                <span>Importe neto (lo que pagamos al proveedor)</span>
                <span className="text-blue-400 font-medium">
                  {((parseFloat(selectedProduct.netPrice ?? "0")) * convertForm.participants).toFixed(2)}€
                </span>
              </div>
            </div>
          )}

          <p className="text-xs text-white/30">
            Se creará una reserva en el CRM con origen "Plataforma" y etiqueta del proveedor. El cupón pasará a estado "Reserva generada".
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-white/70">Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
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
    comments: "", channelEntry: "manual" as const, notes: "",
  });

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
    onSuccess: () => { toast.success("Reserva creada en el CRM con origen Plataforma"); setConvertCoupon(null); setConvertForm({ reservationDate: "", participants: 1, platformProductId: undefined, selectedPlatformId: undefined }); invalidate(); },
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
    onSuccess: () => { toast.success("Cupón marcado como canjeado"); setRedeemCoupon(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteRedemptionMutation = trpc.ticketing.deleteRedemption.useMutation({
    onSuccess: (res) => { toast.success(`Cupón ${res.couponCode} eliminado`); setDeleteCoupon(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const createManualMutation = trpc.ticketing.createManualRedemption.useMutation({
    onSuccess: () => {
      toast.success("Cupón registrado manualmente");
      setManualOpen(false);
      setManualForm({ provider: "Groupon", customerName: "", email: "", phone: "", couponCode: "", securityCode: "", requestedDate: "", station: "", participants: 1, children: 0, comments: "", channelEntry: "manual", notes: "" });
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

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
      <div className="min-h-screen bg-[#080810] text-white">
        <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                <Ticket className="w-6 h-6 text-violet-400" />
                Pipeline de Cupones
              </h1>
              <p className="text-sm text-white/40 mt-1">
                Recibido → Pendiente → Reserva generada · Trazabilidad completa por proveedor
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                onClick={() => window.location.href = "/admin/marketing/plataformas"}>
                <Settings className="w-4 h-4 mr-1" /> Plataformas
              </Button>
              <Button variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                onClick={() => { utils.ticketing.listCoupons.invalidate(); utils.ticketing.getDashboardStats.invalidate(); }}>
                <RefreshCw className="w-4 h-4 mr-1" /> Actualizar
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white"
                onClick={() => setManualOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Alta manual
              </Button>
            </div>
          </div>

          {/* ── DASHBOARD CARDS ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Cupones recibidos" value={stats?.recibidos ?? 0} sub="Sin procesar"
              gradient="bg-gradient-to-br from-blue-900/40 to-blue-800/20"
              icon={<Ticket className="w-5 h-5 text-blue-400" />} />
            <StatCard label="Pendientes" value={stats?.pendientes ?? 0} sub="Sin disponibilidad"
              gradient="bg-gradient-to-br from-amber-900/40 to-amber-800/20"
              icon={<Clock className="w-5 h-5 text-amber-400" />} />
            <StatCard label="Reservas generadas" value={stats?.convertidos ?? 0} sub={`${stats?.conversionRate ?? 0}% conversión`}
              gradient="bg-gradient-to-br from-emerald-900/40 to-emerald-800/20"
              icon={<CalendarCheck className="w-5 h-5 text-emerald-400" />} />
            <StatCard label="Incidencias" value={stats?.incidencias ?? 0} sub="Requieren atención"
              gradient="bg-gradient-to-br from-red-900/40 to-red-800/20"
              icon={<AlertTriangle className="w-5 h-5 text-red-400" />} />
          </div>

          {/* ── MÉTRICAS SECUNDARIAS ─────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Total cupones", value: stats?.total ?? 0, icon: <TrendingUp className="w-4 h-4 text-violet-400" />, bg: "bg-violet-500/10" },
              { label: "Canjeados", value: stats?.canjeados ?? 0, icon: <Banknote className="w-4 h-4 text-emerald-400" />, bg: "bg-emerald-500/10" },
              { label: "% Conversión", value: `${stats?.conversionRate ?? 0}%`, icon: <Zap className="w-4 h-4 text-amber-400" />, bg: "bg-amber-500/10" },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-white/5 bg-white/3 p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${m.bg}`}>{m.icon}</div>
                <div>
                  <p className="text-xs text-white/40">{m.label}</p>
                  <p className="text-lg font-bold text-white">{m.value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* ── TABS ─────────────────────────────────────────────────────────── */}
          <div className="flex gap-1 border-b border-white/5">
            {tabs.map((tab) => (
              <button key={tab.id} onClick={() => { setActiveTab(tab.id); setPage(1); }}
                className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
                  activeTab === tab.id
                    ? "bg-white/8 text-white border-b-2 border-violet-500"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }`}>
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-violet-500/30 text-violet-300" : "bg-white/10 text-white/40"}`}>
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
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <Input placeholder="Buscar por nombre, email, código..."
                    value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 focus:border-violet-500/50" />
                </div>
                <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-48 bg-white/5 border-white/10 text-white">
                    <Filter className="w-4 h-4 mr-2 text-white/40" />
                    <SelectValue placeholder="Proveedor" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    <SelectItem value="all">Todos los proveedores</SelectItem>
                    {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Tabla */}
              <div className="rounded-xl border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/3">
                      {["Cliente", "Código", "Proveedor", "Estado op.", "Estado fin.", "Fecha", ""].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-white/40 font-medium text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {couponsQuery.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-white/5">
                          {Array.from({ length: 7 }).map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="h-4 bg-white/5 rounded animate-pulse" /></td>
                          ))}
                        </tr>
                      ))
                    ) : coupons.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-white/30">No hay cupones en esta vista</td></tr>
                    ) : coupons.map((c) => (
                      <tr key={c.id} className={`border-b border-white/5 hover:bg-white/3 transition-colors ${c.duplicateFlag ? "bg-amber-500/5" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-violet-500/20 flex items-center justify-center text-violet-400 text-xs font-bold shrink-0">
                              {c.customerName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-white font-medium text-sm">{c.customerName}</p>
                              <p className="text-white/40 text-xs">{c.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {c.duplicateFlag && <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" aria-label="Posible duplicado" />}
                            <code className="text-violet-300 text-xs bg-violet-500/10 px-2 py-0.5 rounded">{c.couponCode}</code>
                          </div>
                        </td>
                        <td className="px-4 py-3"><ProviderBadge provider={c.provider} /></td>
                        <td className="px-4 py-3"><OpBadge status={c.statusOperational} /></td>
                        <td className="px-4 py-3"><FinBadge status={c.statusFinancial} /></td>
                        <td className="px-4 py-3 text-white/40 text-xs">
                          {new Date(c.createdAt).toLocaleDateString("es-ES")}
                          {c.requestedDate && <div className="text-white/30">{c.requestedDate}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setDetailCoupon(c)}
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors" aria-label="Ver detalle">
                              <Eye className="w-4 h-4" />
                            </button>
                            {c.statusOperational !== "reserva_generada" && (
                              <button onClick={() => setConvertCoupon(c)}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-400 transition-colors" aria-label="Convertir en reserva">
                                <CalendarCheck className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusOperational === "recibido" && (
                              <button onClick={() => { setPostponeCoupon(c); setPostponeNotes(""); }}
                                className="p-1.5 rounded-lg hover:bg-amber-500/20 text-amber-400/60 hover:text-amber-400 transition-colors" aria-label="Posponer">
                                <Pause className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusFinancial === "pendiente_canjear" && (
                              <button onClick={() => setRedeemCoupon(c)}
                                className="p-1.5 rounded-lg hover:bg-emerald-500/20 text-emerald-400/60 hover:text-emerald-400 transition-colors" aria-label="Marcar como canjeado">
                                <BadgeCheck className="w-4 h-4" />
                              </button>
                            )}
                            {c.statusFinancial !== "incidencia" && (
                              <button onClick={() => { setIncidenceCoupon(c); setIncidenceNotes(""); }}
                                className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/60 hover:text-red-400 transition-colors" aria-label="Marcar incidencia">
                                <AlertTriangle className="w-4 h-4" />
                              </button>
                            )}
                            <button onClick={() => setDeleteCoupon(c)}
                              className="p-1.5 rounded-lg hover:bg-red-700/30 text-red-600/50 hover:text-red-400 transition-colors" aria-label="Eliminar cupón">
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
                  <p className="text-sm text-white/40">
                    Página {page} de {totalPages} · {couponsQuery.data?.total ?? 0} cupones
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                      className="border-white/10 bg-white/5 text-white/70">Anterior</Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                      className="border-white/10 bg-white/5 text-white/70">Siguiente</Button>
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
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="w-5 h-5 text-amber-400" />
              Posponer cupón
            </DialogTitle>
          </DialogHeader>
          {postponeCoupon && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
                Se enviará un email automático al cliente: "Actualmente no hay disponibilidad para la fecha solicitada. Quedará en lista de espera."
              </div>
              <div className="p-3 rounded-lg bg-white/5 text-sm">
                <p className="text-white/60">Cliente: <span className="text-white">{postponeCoupon.customerName}</span></p>
                <p className="text-white/60">Cupón: <code className="text-violet-300">{postponeCoupon.couponCode}</code></p>
              </div>
              <div>
                <Label className="text-white/70 text-sm">Notas internas (opcional)</Label>
                <Textarea value={postponeNotes} onChange={(e) => setPostponeNotes(e.target.value)}
                  placeholder="Motivo del aplazamiento..." className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostponeCoupon(null)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-amber-600 hover:bg-amber-700 text-white"
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
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Marcar incidencia
            </DialogTitle>
          </DialogHeader>
          {incidenceCoupon && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-white/5 text-sm">
                <p className="text-white/60">Cliente: <span className="text-white">{incidenceCoupon.customerName}</span></p>
                <p className="text-white/60">Cupón: <code className="text-violet-300">{incidenceCoupon.couponCode}</code></p>
              </div>
              <div>
                <Label className="text-white/70 text-sm">Descripción de la incidencia</Label>
                <Textarea value={incidenceNotes} onChange={(e) => setIncidenceNotes(e.target.value)}
                  placeholder="Describe el problema..." className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncidenceCoupon(null)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-red-600 hover:bg-red-700 text-white"
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
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-violet-400" />
              Alta manual de cupón
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Proveedor *</Label>
                <Select value={manualForm.provider} onValueChange={(v) => setManualForm(f => ({ ...f, provider: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    {PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/70 text-xs">Canal *</Label>
                <Select value={manualForm.channelEntry} onValueChange={(v) => setManualForm(f => ({ ...f, channelEntry: v as typeof manualForm.channelEntry }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    {["web", "email", "whatsapp", "telefono", "presencial", "manual"].map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Nombre cliente *</Label>
              <Input value={manualForm.customerName} onChange={(e) => setManualForm(f => ({ ...f, customerName: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Email *</Label>
                <Input type="email" value={manualForm.email} onChange={(e) => setManualForm(f => ({ ...f, email: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Teléfono</Label>
                <Input value={manualForm.phone} onChange={(e) => setManualForm(f => ({ ...f, phone: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Código cupón *</Label>
                <Input value={manualForm.couponCode} onChange={(e) => setManualForm(f => ({ ...f, couponCode: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 font-mono" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Código seguridad</Label>
                <Input value={manualForm.securityCode} onChange={(e) => setManualForm(f => ({ ...f, securityCode: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Fecha solicitada</Label>
                <Input type="date" value={manualForm.requestedDate} onChange={(e) => setManualForm(f => ({ ...f, requestedDate: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Participantes</Label>
                <Input type="number" min={1} value={manualForm.participants} onChange={(e) => setManualForm(f => ({ ...f, participants: parseInt(e.target.value) || 1 }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas internas</Label>
              <Textarea value={manualForm.notes} onChange={(e) => setManualForm(f => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!manualForm.customerName || !manualForm.email || !manualForm.couponCode || createManualMutation.isPending}
              onClick={() => createManualMutation.mutate(manualForm)}>
              {createManualMutation.isPending ? "Registrando..." : "Registrar cupón"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmación de borrado */}
      {deleteCoupon && (
        <Dialog open onOpenChange={() => setDeleteCoupon(null)}>
          <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-400">
                <Trash2 className="w-5 h-5" />
                Eliminar cupón
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <p className="text-sm text-red-300">
                  Esta acción es <strong>permanente e irreversible</strong>. El cupón será eliminado completamente del sistema.
                </p>
              </div>
              <div className="p-3 rounded-lg bg-white/5 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-white/40 text-xs w-20">Cliente</span>
                  <span className="text-white text-sm font-medium">{deleteCoupon.customerName}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 text-xs w-20">Código</span>
                  <code className="text-violet-300 font-mono text-sm">{deleteCoupon.couponCode}</code>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 text-xs w-20">Proveedor</span>
                  <ProviderBadge provider={deleteCoupon.provider} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white/40 text-xs w-20">Estado</span>
                  <OpBadge status={deleteCoupon.statusOperational} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteCoupon(null)}
                className="border-white/10 text-white/70 hover:bg-white/10">
                Cancelar
              </Button>
              <Button
                className="bg-red-600 hover:bg-red-700 text-white"
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
  onConfirm: (data: { notes?: string; justificantBase64?: string; justificantFileName?: string; justificantMimeType?: string }) => void;
  isPending: boolean;
}) {
  const [notes, setNotes] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);

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
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        onConfirm({
          notes: notes || undefined,
          justificantBase64: base64,
          justificantFileName: file.name,
          justificantMimeType: file.type,
        });
      };
      reader.readAsDataURL(file);
    } else {
      onConfirm({ notes: notes || undefined });
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-emerald-400" />
            Marcar como canjeado
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-300">
            El cupón pasará a estado <strong>Canjeado</strong> y quedará listo para incluir en la próxima liquidación.
          </div>
          <div className="p-3 rounded-lg bg-white/5 text-sm space-y-1">
            <p className="text-white/60">Cliente: <span className="text-white">{coupon.customerName}</span></p>
            <p className="text-white/60">Cupón: <code className="text-violet-300">{coupon.couponCode}</code></p>
            <p className="text-white/60">Proveedor: <span className="text-white">{coupon.provider}</span></p>
          </div>

          {/* Subida de comprobante */}
          <div>
            <Label className="text-white/70 text-sm mb-2 block">Comprobante de canje (PDF o imagen)</Label>
            <label className="flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-white/10 hover:border-emerald-500/40 cursor-pointer transition-colors bg-white/3 hover:bg-emerald-500/5">
              <Upload className="w-6 h-6 text-white/30" />
              <span className="text-xs text-white/40">{file ? file.name : "Arrastra o haz clic para subir"}</span>
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleFileChange} />
            </label>
            {file && (
              <div className="mt-2 flex items-center justify-between p-2 rounded-lg bg-white/5 text-xs">
                <span className="text-white/70 truncate">{file.name}</span>
                <button onClick={() => { setFile(null); setFilePreview(null); }} className="text-white/30 hover:text-red-400 ml-2">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {filePreview && (
              <img src={filePreview} alt="Preview" className="mt-2 rounded-lg max-h-32 object-contain w-full" />
            )}
          </div>

          <div>
            <Label className="text-white/70 text-sm">Notas internas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones del canje..." className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-white/70">Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isPending}
            onClick={handleConfirm}>
            {isPending ? "Guardando..." : "✅ Confirmar canje"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── LIQUIDACIONES TAB ────────────────────────────────────────────────────────
function LiquidacionesTab() {
  const settlementsQuery = trpc.ticketing.listSettlements.useQuery({});
  const settlements = settlementsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Liquidaciones de plataformas</h2>
        <Button variant="outline" size="sm"
          className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
          onClick={() => window.location.href = "/admin/marketing/plataformas"}>
          Gestionar plataformas <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
      {settlements.length === 0 ? (
        <div className="rounded-xl border border-white/5 p-12 text-center text-white/30">
          No hay liquidaciones registradas. Crea plataformas y genera liquidaciones desde el módulo de Plataformas.
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 bg-white/3">
                {["Plataforma", "Periodo", "Cupones", "Importe", "Estado"].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-white/40 font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settlements.map((s) => (
                <tr key={s.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-4 py-3 text-white font-medium">{s.platformName ?? `Plataforma #${s.platformId}`}</td>
                  <td className="px-4 py-3 text-white/60">{s.periodLabel}</td>
                  <td className="px-4 py-3 text-white">{s.totalCoupons}</td>
                  <td className="px-4 py-3 text-white font-medium">{s.totalAmount} €</td>
                  <td className="px-4 py-3">
                    {s.status === "pagada" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        <CheckCircle className="w-3 h-3" /> Pagada
                      </span>
                    ) : s.status === "emitida" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-500/15 text-blue-400 border-blue-500/30">
                        <Zap className="w-3 h-3" /> Emitida
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/15 text-amber-400 border-amber-500/30">
                        <Clock className="w-3 h-3" /> Pendiente
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
