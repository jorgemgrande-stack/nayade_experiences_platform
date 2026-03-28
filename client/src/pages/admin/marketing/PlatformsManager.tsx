/**
 * PlatformsManager — Gestión de Plataformas de Cupones
 * v23.2: Productos con PVP/neto/caducidad · Liquidaciones Pendiente/Emitida/Pagada
 * Diseño oscuro tipo CRM · Coherencia total con CuponesManager
 */
import React, { useState } from "react";
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
  Settings, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Package,
  Banknote, Globe, RefreshCw, ChevronRight, CheckCircle, Clock, ArrowLeft,
  Zap, AlertCircle, ExternalLink, CalendarDays, Euro,
} from "lucide-react";

// ─── TIPOS ────────────────────────────────────────────────────────────────────
interface Platform {
  id: number;
  name: string;
  slug: string;
  logoUrl?: string | null;
  active: boolean;
  settlementFrequency: "quincenal" | "mensual" | "trimestral";
  commissionPct?: string | null;
  externalUrl?: string | null;
  notes?: string | null;
  createdAt: Date;
}

interface PlatformProduct {
  id: number;
  platformId: number;
  experienceId?: number | null;
  externalLink?: string | null;
  externalProductName?: string | null;
  pvpPrice?: string | null;
  netPrice?: string | null;
  expiresAt?: Date | string | null;
  active: boolean;
  experienceTitle?: string | null;
  experienceBasePrice?: string | null;
  updatedAt?: Date | null;
}

interface Settlement {
  id: number;
  platformId: number;
  platformName?: string | null;
  platformFrequency?: string | null;
  periodLabel: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  totalCoupons: number;
  totalAmount: string;
  netTotal?: string | null;
  status: "pendiente" | "emitida" | "pagada";
  justificantUrl?: string | null;
  invoiceRef?: string | null;
  couponIds?: number[] | null;
  notes?: string | null;
  emittedAt?: Date | null;
  paidAt?: Date | null;
  createdAt: Date;
}

const FREQ_OPTIONS = [
  { value: "mensual", label: "Mensual" },
  { value: "quincenal", label: "Quincenal" },
  { value: "trimestral", label: "Trimestral" },
];

const SETTLEMENT_STATUS_CONFIG = {
  pendiente: { label: "Pendiente", color: "text-amber-400 bg-amber-500/15 border-amber-500/30", icon: Clock },
  emitida:   { label: "Emitida",   color: "text-blue-400 bg-blue-500/15 border-blue-500/30",   icon: Zap },
  pagada:    { label: "Pagada",    color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30", icon: CheckCircle },
};

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isExpiringSoon(d: Date | string | null | undefined): boolean {
  if (!d) return false;
  const diff = new Date(d).getTime() - Date.now();
  return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000; // 30 días
}

function isExpired(d: Date | string | null | undefined): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

// ─── PLATFORM CARD ────────────────────────────────────────────────────────────
function PlatformCard({ platform, onEdit, onToggle, onDelete, onSelect, isSelected }: {
  platform: Platform;
  onEdit: (p: Platform) => void;
  onToggle: (id: number, active: boolean) => void;
  onDelete: (id: number) => void;
  onSelect: (p: Platform) => void;
  isSelected: boolean;
}) {
  return (
    <div
      className={`rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? "border-violet-500/50 bg-violet-500/10"
          : "border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/5"
      }`}
      onClick={() => onSelect(platform)}
    >
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {platform.logoUrl ? (
              <img src={platform.logoUrl} alt={platform.name} className="w-10 h-10 rounded-lg object-cover bg-white/10" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
                {platform.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-white font-semibold">{platform.name}</p>
              <p className="text-white/40 text-xs">
                {FREQ_OPTIONS.find(f => f.value === platform.settlementFrequency)?.label ?? platform.settlementFrequency}
                {platform.commissionPct ? ` · ${platform.commissionPct}% comisión` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(platform.id, !platform.active); }}
              className={`p-1.5 rounded-lg transition-colors ${platform.active ? "text-emerald-400 hover:bg-emerald-500/20" : "text-white/30 hover:bg-white/10"}`}
            >
              {platform.active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(platform); }}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(platform.id); }}
              className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/50 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
            platform.active
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
              : "bg-slate-500/15 text-slate-400 border-slate-500/30"
          }`}>
            {platform.active ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {platform.active ? "Activa" : "Inactiva"}
          </span>
          {platform.externalUrl && (
            <a
              href={platform.externalUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-blue-400 hover:text-blue-300 border border-blue-500/20 bg-blue-500/10"
            >
              <Globe className="w-3 h-3" /> Web
            </a>
          )}
        </div>
        {isSelected && (
          <div className="mt-2 flex items-center gap-1 text-violet-400 text-xs">
            <ChevronRight className="w-3 h-3" /> Seleccionada — ver productos y liquidaciones
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PlatformsManager() {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);
  const [activeSection, setActiveSection] = useState<"productos" | "liquidaciones">("productos");

  // Platform form
  const [platformFormOpen, setPlatformFormOpen] = useState(false);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [platformForm, setPlatformForm] = useState({
    name: "", slug: "", logoUrl: "", active: true,
    settlementFrequency: "mensual" as "quincenal" | "mensual" | "trimestral",
    commissionPct: "", externalUrl: "", notes: "",
  });

  // Product form — now with pvpPrice, netPrice, expiresAt
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PlatformProduct | null>(null);
  const [productForm, setProductForm] = useState({
    externalProductName: "", externalLink: "", pvpPrice: "", netPrice: "",
    expiresAt: "", active: true,
  });

  // Settlement form — 3 states
  const [settlementFormOpen, setSettlementFormOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const [settlementForm, setSettlementForm] = useState({
    periodLabel: "", periodFrom: "", periodTo: "",
    totalCoupons: 0, totalAmount: "0.00", netTotal: "0.00",
    invoiceRef: "", justificantUrl: "", notes: "",
    status: "pendiente" as "pendiente" | "emitida" | "pagada",
  });

  // Generate settlement modal
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateForm, setGenerateForm] = useState({ periodLabel: "", periodFrom: "", periodTo: "", notes: "" });

  // Settlement detail (coupons list)
  const [detailSettlement, setDetailSettlement] = useState<Settlement | null>(null);

  // ── QUERIES ──────────────────────────────────────────────────────────────
  const platformsQuery = trpc.ticketing.listPlatforms.useQuery();
  const productsQuery = trpc.ticketing.listPlatformProducts.useQuery(
    { platformId: selectedPlatform?.id ?? 0 },
    { enabled: !!selectedPlatform }
  );
  const settlementsQuery = trpc.ticketing.listSettlements.useQuery(
    { platformId: selectedPlatform?.id },
    { enabled: !!selectedPlatform }
  );
  const settlementCouponsQuery = trpc.ticketing.listSettlementCoupons.useQuery(
    { settlementId: detailSettlement?.id ?? 0 },
    { enabled: !!detailSettlement }
  );

  const utils = trpc.useUtils();

  // ── PLATFORM MUTATIONS ────────────────────────────────────────────────────
  const createPlatform = trpc.ticketing.createPlatform.useMutation({
    onSuccess: () => { toast.success("Plataforma creada"); setPlatformFormOpen(false); utils.ticketing.listPlatforms.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updatePlatform = trpc.ticketing.updatePlatform.useMutation({
    onSuccess: () => { toast.success("Plataforma actualizada"); setPlatformFormOpen(false); setEditingPlatform(null); utils.ticketing.listPlatforms.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const togglePlatform = trpc.ticketing.togglePlatform.useMutation({
    onSuccess: () => utils.ticketing.listPlatforms.invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const deletePlatform = trpc.ticketing.deletePlatform.useMutation({
    onSuccess: () => { toast.success("Plataforma eliminada"); setSelectedPlatform(null); utils.ticketing.listPlatforms.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // ── PRODUCT MUTATIONS ─────────────────────────────────────────────────────
  const createProduct = trpc.ticketing.createPlatformProduct.useMutation({
    onSuccess: () => { toast.success("Producto añadido"); setProductFormOpen(false); utils.ticketing.listPlatformProducts.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateProduct = trpc.ticketing.updatePlatformProduct.useMutation({
    onSuccess: () => { toast.success("Producto actualizado"); setProductFormOpen(false); setEditingProduct(null); utils.ticketing.listPlatformProducts.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteProduct = trpc.ticketing.deletePlatformProduct.useMutation({
    onSuccess: () => { toast.success("Producto eliminado"); utils.ticketing.listPlatformProducts.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  // ── SETTLEMENT MUTATIONS ──────────────────────────────────────────────────
  const createSettlement = trpc.ticketing.createSettlement.useMutation({
    onSuccess: () => { toast.success("Liquidación creada"); setSettlementFormOpen(false); utils.ticketing.listSettlements.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateSettlement = trpc.ticketing.updateSettlement.useMutation({
    onSuccess: () => { toast.success("Liquidación actualizada"); setSettlementFormOpen(false); setEditingSettlement(null); utils.ticketing.listSettlements.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteSettlement = trpc.ticketing.deleteSettlement.useMutation({
    onSuccess: () => { toast.success("Liquidación eliminada"); utils.ticketing.listSettlements.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const generateSettlement = trpc.ticketing.generateSettlement.useMutation({
    onSuccess: (data) => {
      toast.success(`Liquidación generada: ${data.totalCoupons} cupones · ${data.netTotal.toFixed(2)} € neto`);
      setGenerateModalOpen(false);
      utils.ticketing.listSettlements.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const platforms = (platformsQuery.data ?? []) as Platform[];
  const products = (productsQuery.data ?? []) as PlatformProduct[];
  const settlements = (settlementsQuery.data ?? []) as Settlement[];

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const openCreatePlatform = () => {
    setEditingPlatform(null);
    setPlatformForm({ name: "", slug: "", logoUrl: "", active: true, settlementFrequency: "mensual", commissionPct: "", externalUrl: "", notes: "" });
    setPlatformFormOpen(true);
  };
  const openEditPlatform = (p: Platform) => {
    setEditingPlatform(p);
    setPlatformForm({ name: p.name, slug: p.slug, logoUrl: p.logoUrl ?? "", active: p.active, settlementFrequency: p.settlementFrequency, commissionPct: p.commissionPct ?? "", externalUrl: p.externalUrl ?? "", notes: p.notes ?? "" });
    setPlatformFormOpen(true);
  };
  const openCreateProduct = () => {
    setEditingProduct(null);
    setProductForm({ externalProductName: "", externalLink: "", pvpPrice: "", netPrice: "", expiresAt: "", active: true });
    setProductFormOpen(true);
  };
  const openEditProduct = (p: PlatformProduct) => {
    setEditingProduct(p);
    setProductForm({
      externalProductName: p.externalProductName ?? "",
      externalLink: p.externalLink ?? "",
      pvpPrice: p.pvpPrice ?? "",
      netPrice: p.netPrice ?? "",
      expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString().split("T")[0] : "",
      active: p.active,
    });
    setProductFormOpen(true);
  };
  const openCreateSettlement = () => {
    setEditingSettlement(null);
    setSettlementForm({ periodLabel: "", periodFrom: "", periodTo: "", totalCoupons: 0, totalAmount: "0.00", netTotal: "0.00", invoiceRef: "", justificantUrl: "", notes: "", status: "pendiente" });
    setSettlementFormOpen(true);
  };
  const openEditSettlement = (s: Settlement) => {
    setEditingSettlement(s);
    setSettlementForm({
      periodLabel: s.periodLabel, periodFrom: s.periodFrom ?? "", periodTo: s.periodTo ?? "",
      totalCoupons: s.totalCoupons, totalAmount: s.totalAmount, netTotal: s.netTotal ?? "0.00",
      invoiceRef: s.invoiceRef ?? "", justificantUrl: s.justificantUrl ?? "", notes: s.notes ?? "",
      status: s.status,
    });
    setSettlementFormOpen(true);
  };

  // ── SETTLEMENT STATS ──────────────────────────────────────────────────────
  const settlementStats = {
    total: settlements.length,
    pendiente: settlements.filter(s => s.status === "pendiente").length,
    emitida: settlements.filter(s => s.status === "emitida").length,
    pagada: settlements.filter(s => s.status === "pagada").length,
    totalNet: settlements.reduce((sum, s) => sum + parseFloat(s.netTotal ?? "0"), 0),
    pendienteNet: settlements.filter(s => s.status !== "pagada").reduce((sum, s) => sum + parseFloat(s.netTotal ?? "0"), 0),
  };

  return (
    <AdminLayout>
      <div className="min-h-screen bg-[#080810] text-white">
        <div className="max-w-[1600px] mx-auto px-6 py-8 space-y-8">

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.location.href = "/admin/marketing/cupones"}
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Settings className="w-6 h-6 text-violet-400" />
                  Plataformas de Cupones
                </h1>
                <p className="text-sm text-white/40 mt-1">Configura proveedores, productos y liquidaciones</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm"
                className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                onClick={() => utils.ticketing.listPlatforms.invalidate()}>
                <RefreshCw className="w-4 h-4 mr-1" /> Actualizar
              </Button>
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700 text-white" onClick={openCreatePlatform}>
                <Plus className="w-4 h-4 mr-1" /> Nueva plataforma
              </Button>
            </div>
          </div>

          {/* ── LAYOUT ───────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Lista de plataformas */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">
                Plataformas ({platforms.length})
              </h2>
              {platformsQuery.isPending ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-white/5 p-4 animate-pulse">
                    <div className="h-4 bg-white/5 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-white/5 rounded w-1/2" />
                  </div>
                ))
              ) : platforms.length === 0 ? (
                <div className="rounded-xl border border-white/5 p-8 text-center text-white/30 text-sm">
                  No hay plataformas. Crea la primera.
                </div>
              ) : platforms.map((p) => (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  onEdit={openEditPlatform}
                  onToggle={(id, active) => togglePlatform.mutate({ id, active })}
                  onDelete={(id) => {
                    if (confirm("¿Eliminar esta plataforma? Se eliminarán también sus productos.")) {
                      deletePlatform.mutate({ id });
                    }
                  }}
                  onSelect={setSelectedPlatform}
                  isSelected={selectedPlatform?.id === p.id}
                />
              ))}
            </div>

            {/* Panel de detalle */}
            <div className="lg:col-span-2">
              {!selectedPlatform ? (
                <div className="rounded-xl border border-white/5 p-12 text-center text-white/30">
                  <Settings className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p>Selecciona una plataforma para ver sus productos y liquidaciones</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Cabecera plataforma seleccionada */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {selectedPlatform.logoUrl ? (
                        <img src={selectedPlatform.logoUrl} alt={selectedPlatform.name} className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400 font-bold text-sm">
                          {selectedPlatform.name.charAt(0)}
                        </div>
                      )}
                      <h2 className="text-lg font-semibold text-white">{selectedPlatform.name}</h2>
                    </div>
                    <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                      {(["productos", "liquidaciones"] as const).map((s) => (
                        <button key={s} onClick={() => setActiveSection(s)}
                          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            activeSection === s ? "bg-violet-600 text-white" : "text-white/50 hover:text-white"
                          }`}>
                          {s === "productos"
                            ? <><Package className="w-3.5 h-3.5 inline mr-1" />Productos</>
                            : <><Banknote className="w-3.5 h-3.5 inline mr-1" />Liquidaciones</>}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── PRODUCTOS ──────────────────────────────────────────── */}
                  {activeSection === "productos" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white/40">
                          Productos de <span className="text-white">{selectedPlatform.name}</span>
                          {" "}— {products.filter(p => p.active).length} activos
                        </p>
                        <Button size="sm" variant="outline" onClick={openCreateProduct}
                          className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 h-8">
                          <Plus className="w-3.5 h-3.5 mr-1" /> Añadir producto
                        </Button>
                      </div>
                      <div className="rounded-xl border border-white/5 overflow-hidden">
                        {products.length === 0 ? (
                          <div className="p-8 text-center text-white/30 text-sm">
                            <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No hay productos configurados para esta plataforma.
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/[0.03]">
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Producto</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">PVP</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Precio neto</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Caduca</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Estado</th>
                                <th className="px-4 py-3" />
                              </tr>
                            </thead>
                            <tbody>
                              {products.map((p) => {
                                const expired = isExpired(p.expiresAt);
                                const expiring = isExpiringSoon(p.expiresAt);
                                return (
                                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                                    <td className="px-4 py-3">
                                      <p className="text-white font-medium text-sm">
                                        {p.externalProductName ?? p.experienceTitle ?? "—"}
                                      </p>
                                      {p.experienceTitle && p.externalProductName && (
                                        <p className="text-white/40 text-xs">→ {p.experienceTitle}</p>
                                      )}
                                      {p.externalLink && (
                                        <a href={p.externalLink} target="_blank" rel="noreferrer"
                                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs mt-0.5">
                                          <ExternalLink className="w-3 h-3" /> Ver en plataforma
                                        </a>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      {p.pvpPrice ? (
                                        <span className="text-white font-semibold">{parseFloat(p.pvpPrice).toFixed(2)} €</span>
                                      ) : <span className="text-white/30 text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                      {p.netPrice ? (
                                        <span className="text-emerald-400 font-semibold">{parseFloat(p.netPrice).toFixed(2)} €</span>
                                      ) : <span className="text-white/30 text-xs">—</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                      {p.expiresAt ? (
                                        <span className={`text-xs font-medium flex items-center gap-1 ${
                                          expired ? "text-red-400" : expiring ? "text-amber-400" : "text-white/60"
                                        }`}>
                                          {expired && <AlertCircle className="w-3 h-3" />}
                                          {expiring && !expired && <Clock className="w-3 h-3" />}
                                          {expired && !expiring && <CalendarDays className="w-3 h-3" />}
                                          {formatDate(p.expiresAt)}
                                        </span>
                                      ) : <span className="text-white/30 text-xs">Sin caducidad</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${
                                        p.active
                                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                          : "bg-slate-500/15 text-slate-400 border-slate-500/30"
                                      }`}>
                                        {p.active ? "Activo" : "Inactivo"}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-end gap-1">
                                        <button onClick={() => openEditProduct(p)}
                                          className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => {
                                          if (confirm("¿Eliminar este producto?")) deleteProduct.mutate({ id: p.id });
                                        }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/50 hover:text-red-400 transition-colors">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── LIQUIDACIONES ──────────────────────────────────────── */}
                  {activeSection === "liquidaciones" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-white/40">Liquidaciones de <span className="text-white">{selectedPlatform.name}</span></p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => {
                            setGenerateForm({ periodLabel: "", periodFrom: "", periodTo: "", notes: "" });
                            setGenerateModalOpen(true);
                          }}
                            className="border-violet-500/30 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 h-8">
                            <Zap className="w-3.5 h-3.5 mr-1" /> Generar automática
                          </Button>
                          <Button size="sm" variant="outline" onClick={openCreateSettlement}
                            className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 h-8">
                            <Plus className="w-3.5 h-3.5 mr-1" /> Manual
                          </Button>
                        </div>
                      </div>

                      {/* Stats de liquidaciones */}
                      {settlements.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                            <p className="text-xs text-white/40">Total</p>
                            <p className="text-xl font-bold text-white">{settlementStats.total}</p>
                          </div>
                          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="text-xs text-amber-400/70">Pendientes</p>
                            <p className="text-xl font-bold text-amber-400">{settlementStats.pendiente}</p>
                          </div>
                          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                            <p className="text-xs text-blue-400/70">Emitidas</p>
                            <p className="text-xl font-bold text-blue-400">{settlementStats.emitida}</p>
                          </div>
                          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                            <p className="text-xs text-emerald-400/70">Neto pendiente</p>
                            <p className="text-xl font-bold text-emerald-400">{settlementStats.pendienteNet.toFixed(2)} €</p>
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-white/5 overflow-hidden">
                        {settlements.length === 0 ? (
                          <div className="p-8 text-center text-white/30 text-sm">
                            <Banknote className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No hay liquidaciones registradas para esta plataforma.
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/[0.03]">
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Periodo</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Cupones</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">PVP total</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Neto</th>
                                <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Estado</th>
                                <th className="px-4 py-3" />
                              </tr>
                            </thead>
                            <tbody>
                              {settlements.map((s) => {
                                const cfg = SETTLEMENT_STATUS_CONFIG[s.status] ?? SETTLEMENT_STATUS_CONFIG.pendiente;
                                const Icon = cfg.icon;
                                return (
                                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                                    <td className="px-4 py-3">
                                      <p className="text-white font-medium">{s.periodLabel}</p>
                                      {(s.periodFrom || s.periodTo) && (
                                        <p className="text-white/40 text-xs">{formatDate(s.periodFrom)} — {formatDate(s.periodTo)}</p>
                                      )}
                                      {s.invoiceRef && (
                                        <p className="text-violet-400 text-xs">Ref: {s.invoiceRef}</p>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <button
                                        onClick={() => setDetailSettlement(s)}
                                        className="text-white hover:text-violet-300 font-medium underline decoration-dotted underline-offset-2"
                                      >
                                        {s.totalCoupons}
                                      </button>
                                    </td>
                                    <td className="px-4 py-3 text-white font-medium">{parseFloat(s.totalAmount).toFixed(2)} €</td>
                                    <td className="px-4 py-3 text-emerald-400 font-semibold">{parseFloat(s.netTotal ?? "0").toFixed(2)} €</td>
                                    <td className="px-4 py-3">
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
                                        <Icon className="w-3 h-3" /> {cfg.label}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center justify-end gap-1">
                                        <button onClick={() => openEditSettlement(s)}
                                          className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                                          <Edit2 className="w-3.5 h-3.5" />
                                        </button>
                                        <button onClick={() => {
                                          if (confirm("¿Eliminar esta liquidación?")) deleteSettlement.mutate({ id: s.id });
                                        }} className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400/50 hover:text-red-400 transition-colors">
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MODAL: PLATAFORMA ─────────────────────────────────────────────── */}
      <Dialog open={platformFormOpen} onOpenChange={setPlatformFormOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-violet-400" />
              {editingPlatform ? "Editar plataforma" : "Nueva plataforma"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-white/70 text-xs">Nombre *</Label>
              <Input
                value={platformForm.name}
                onChange={(e) => setPlatformForm(f => ({ ...f, name: e.target.value, slug: editingPlatform ? f.slug : slugify(e.target.value) }))}
                placeholder="Ej: Groupon"
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs">Slug (identificador único) *</Label>
              <Input
                value={platformForm.slug}
                onChange={(e) => setPlatformForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                placeholder="groupon"
                className="bg-white/5 border-white/10 text-white mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL del logo</Label>
              <Input value={platformForm.logoUrl} onChange={(e) => setPlatformForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL del proveedor</Label>
              <Input value={platformForm.externalUrl} onChange={(e) => setPlatformForm(f => ({ ...f, externalUrl: e.target.value }))} placeholder="https://..." className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Frecuencia liquidación</Label>
                <Select value={platformForm.settlementFrequency} onValueChange={(v) => setPlatformForm(f => ({ ...f, settlementFrequency: v as "quincenal" | "mensual" | "trimestral" }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    {FREQ_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/70 text-xs">Comisión (%)</Label>
                <Input type="number" min={0} max={100} step={0.01} value={platformForm.commissionPct} onChange={(e) => setPlatformForm(f => ({ ...f, commissionPct: e.target.value }))} placeholder="20.00" className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas</Label>
              <Textarea value={platformForm.notes} onChange={(e) => setPlatformForm(f => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPlatformForm(f => ({ ...f, active: !f.active }))}>
                {platformForm.active ? <ToggleRight className="w-6 h-6 text-emerald-400" /> : <ToggleLeft className="w-6 h-6 text-white/30" />}
              </button>
              <span className="text-sm text-white/60">{platformForm.active ? "Activa" : "Inactiva"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlatformFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!platformForm.name || !platformForm.slug || createPlatform.isPending || updatePlatform.isPending}
              onClick={() => {
                const data = { name: platformForm.name, slug: platformForm.slug, logoUrl: platformForm.logoUrl || undefined, active: platformForm.active, settlementFrequency: platformForm.settlementFrequency, commissionPct: platformForm.commissionPct || undefined, externalUrl: platformForm.externalUrl || undefined, notes: platformForm.notes || undefined };
                if (editingPlatform) updatePlatform.mutate({ id: editingPlatform.id, ...data });
                else createPlatform.mutate(data);
              }}>
              {editingPlatform ? "Guardar cambios" : "Crear plataforma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: PRODUCTO ───────────────────────────────────────────────── */}
      <Dialog open={productFormOpen} onOpenChange={setProductFormOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-400" />
              {editingProduct ? "Editar producto" : "Añadir producto"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-white/70 text-xs">Nombre del producto en la plataforma *</Label>
              <Input value={productForm.externalProductName} onChange={(e) => setProductForm(f => ({ ...f, externalProductName: e.target.value }))} placeholder="Ej: Forfait día completo adulto" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL del producto en la plataforma</Label>
              <Input value={productForm.externalLink} onChange={(e) => setProductForm(f => ({ ...f, externalLink: e.target.value }))} placeholder="https://www.groupon.es/deals/..." className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs flex items-center gap-1"><Euro className="w-3 h-3" /> Precio PVP (€)</Label>
                <Input type="number" min={0} step={0.01} value={productForm.pvpPrice} onChange={(e) => setProductForm(f => ({ ...f, pvpPrice: e.target.value }))} placeholder="45.00" className="bg-white/5 border-white/10 text-white mt-1" />
                <p className="text-white/30 text-xs mt-1">Precio de venta al público</p>
              </div>
              <div>
                <Label className="text-white/70 text-xs flex items-center gap-1 text-emerald-400/80"><Euro className="w-3 h-3" /> Precio neto (€)</Label>
                <Input type="number" min={0} step={0.01} value={productForm.netPrice} onChange={(e) => setProductForm(f => ({ ...f, netPrice: e.target.value }))} placeholder="36.00" className="bg-white/5 border-white/10 text-white mt-1" />
                <p className="text-white/30 text-xs mt-1">Lo que nos paga el proveedor</p>
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Fecha de caducidad del producto</Label>
              <Input type="date" value={productForm.expiresAt} onChange={(e) => setProductForm(f => ({ ...f, expiresAt: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              <p className="text-white/30 text-xs mt-1">Dejar vacío si no tiene caducidad</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setProductForm(f => ({ ...f, active: !f.active }))}>
                {productForm.active ? <ToggleRight className="w-6 h-6 text-emerald-400" /> : <ToggleLeft className="w-6 h-6 text-white/30" />}
              </button>
              <span className="text-sm text-white/60">{productForm.active ? "Activo — aparece en el selector de conversión" : "Inactivo — no aparece en el selector"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!productForm.externalProductName || createProduct.isPending || updateProduct.isPending}
              onClick={() => {
                if (!selectedPlatform) return;
                const data = {
                  platformId: selectedPlatform.id,
                  externalProductName: productForm.externalProductName || undefined,
                  externalLink: productForm.externalLink || undefined,
                  pvpPrice: productForm.pvpPrice || undefined,
                  netPrice: productForm.netPrice || undefined,
                  expiresAt: productForm.expiresAt || undefined,
                  active: productForm.active,
                };
                if (editingProduct) updateProduct.mutate({ id: editingProduct.id, externalProductName: data.externalProductName, externalLink: data.externalLink, pvpPrice: data.pvpPrice, netPrice: data.netPrice, expiresAt: data.expiresAt, active: data.active });
                else createProduct.mutate(data);
              }}>
              {editingProduct ? "Guardar cambios" : "Añadir producto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: LIQUIDACIÓN MANUAL ─────────────────────────────────────── */}
      <Dialog open={settlementFormOpen} onOpenChange={setSettlementFormOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-violet-400" />
              {editingSettlement ? "Editar liquidación" : "Nueva liquidación manual"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-white/70 text-xs">Etiqueta del periodo *</Label>
              <Input value={settlementForm.periodLabel} onChange={(e) => setSettlementForm(f => ({ ...f, periodLabel: e.target.value }))} placeholder="Ej: Enero 2026" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Desde</Label>
                <Input type="date" value={settlementForm.periodFrom} onChange={(e) => setSettlementForm(f => ({ ...f, periodFrom: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Hasta</Label>
                <Input type="date" value={settlementForm.periodTo} onChange={(e) => setSettlementForm(f => ({ ...f, periodTo: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Nº cupones</Label>
                <Input type="number" min={0} value={settlementForm.totalCoupons} onChange={(e) => setSettlementForm(f => ({ ...f, totalCoupons: parseInt(e.target.value) || 0 }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Importe PVP (€)</Label>
                <Input type="number" min={0} step={0.01} value={settlementForm.totalAmount} onChange={(e) => setSettlementForm(f => ({ ...f, totalAmount: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs text-emerald-400/80">Importe neto a cobrar (€)</Label>
              <Input type="number" min={0} step={0.01} value={settlementForm.netTotal} onChange={(e) => setSettlementForm(f => ({ ...f, netTotal: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-xs">Estado</Label>
              <Select value={settlementForm.status} onValueChange={(v) => setSettlementForm(f => ({ ...f, status: v as "pendiente" | "emitida" | "pagada" }))}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/10">
                  <SelectItem value="pendiente">Pendiente de cobro</SelectItem>
                  <SelectItem value="emitida">Emitida (factura enviada)</SelectItem>
                  <SelectItem value="pagada">Pagada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Referencia factura</Label>
              <Input value={settlementForm.invoiceRef} onChange={(e) => setSettlementForm(f => ({ ...f, invoiceRef: e.target.value }))} placeholder="FAC-2026-001" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL justificante</Label>
              <Input value={settlementForm.justificantUrl} onChange={(e) => setSettlementForm(f => ({ ...f, justificantUrl: e.target.value }))} placeholder="https://..." className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas</Label>
              <Textarea value={settlementForm.notes} onChange={(e) => setSettlementForm(f => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!settlementForm.periodLabel || createSettlement.isPending || updateSettlement.isPending}
              onClick={() => {
                if (!selectedPlatform) return;
                if (editingSettlement) {
                  updateSettlement.mutate({ id: editingSettlement.id, status: settlementForm.status, totalCoupons: settlementForm.totalCoupons, totalAmount: String(settlementForm.totalAmount), netTotal: String(settlementForm.netTotal), invoiceRef: settlementForm.invoiceRef || undefined, justificantUrl: settlementForm.justificantUrl || undefined, notes: settlementForm.notes || undefined });
                } else {
                  createSettlement.mutate({ platformId: selectedPlatform.id, periodLabel: settlementForm.periodLabel, periodFrom: settlementForm.periodFrom || undefined, periodTo: settlementForm.periodTo || undefined, totalCoupons: settlementForm.totalCoupons, totalAmount: String(settlementForm.totalAmount), netTotal: String(settlementForm.netTotal), invoiceRef: settlementForm.invoiceRef || undefined, notes: settlementForm.notes || undefined });
                }
              }}>
              {editingSettlement ? "Guardar cambios" : "Crear liquidación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: GENERAR LIQUIDACIÓN AUTOMÁTICA ─────────────────────────── */}
      <Dialog open={generateModalOpen} onOpenChange={setGenerateModalOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-violet-400" />
              Generar liquidación automática
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 text-sm text-violet-300">
              Agrupa automáticamente todos los cupones <strong>canjeados</strong> de <strong>{selectedPlatform?.name}</strong> en el periodo seleccionado que aún no tengan liquidación asignada.
            </div>
            <div>
              <Label className="text-white/70 text-xs">Etiqueta del periodo *</Label>
              <Input value={generateForm.periodLabel} onChange={(e) => setGenerateForm(f => ({ ...f, periodLabel: e.target.value }))} placeholder="Ej: Enero 2026" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Desde *</Label>
                <Input type="date" value={generateForm.periodFrom} onChange={(e) => setGenerateForm(f => ({ ...f, periodFrom: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Hasta *</Label>
                <Input type="date" value={generateForm.periodTo} onChange={(e) => setGenerateForm(f => ({ ...f, periodTo: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas</Label>
              <Textarea value={generateForm.notes} onChange={(e) => setGenerateForm(f => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 text-white mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateModalOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!generateForm.periodLabel || !generateForm.periodFrom || !generateForm.periodTo || generateSettlement.isPending}
              onClick={() => {
                if (!selectedPlatform) return;
                generateSettlement.mutate({ platformId: selectedPlatform.id, periodLabel: generateForm.periodLabel, periodFrom: generateForm.periodFrom, periodTo: generateForm.periodTo, notes: generateForm.notes || undefined });
              }}>
              {generateSettlement.isPending ? "Generando..." : "Generar liquidación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: DETALLE CUPONES DE LIQUIDACIÓN ─────────────────────────── */}
      <Dialog open={!!detailSettlement} onOpenChange={(o) => { if (!o) setDetailSettlement(null); }}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-violet-400" />
              Cupones de la liquidación: {detailSettlement?.periodLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {settlementCouponsQuery.isPending ? (
              <div className="text-center text-white/40 py-8">Cargando cupones...</div>
            ) : (settlementCouponsQuery.data?.length ?? 0) === 0 ? (
              <div className="text-center text-white/30 py-8 text-sm">No hay cupones vinculados a esta liquidación.</div>
            ) : (
              <div className="rounded-xl border border-white/5 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.03]">
                      <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Código</th>
                      <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Cliente</th>
                      <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Producto</th>
                      <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">PVP</th>
                      <th className="text-left px-4 py-3 text-white/40 font-medium text-xs">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(settlementCouponsQuery.data ?? []).map((c: { id: number; couponCode: string | null; customerName: string; productName?: string | null; pvpPrice?: string | null; netPrice?: string | null }) => (
                      <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-mono text-violet-300 text-xs">{c.couponCode ?? "—"}</td>
                        <td className="px-4 py-3 text-white text-sm">{c.customerName}</td>
                        <td className="px-4 py-3 text-white/60 text-xs">{c.productName ?? "—"}</td>
                        <td className="px-4 py-3 text-white text-sm">{c.pvpPrice ? `${parseFloat(c.pvpPrice).toFixed(2)} €` : "—"}</td>
                        <td className="px-4 py-3 text-emerald-400 font-semibold text-sm">{c.netPrice ? `${parseFloat(c.netPrice).toFixed(2)} €` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailSettlement(null)} className="border-white/10 text-white/70">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
