/**
 * PlatformsManager — Gestión de Plataformas de Cupones
 * v23.1: Configuración · Productos · Liquidaciones
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
} from "lucide-react";

// ─── TIPOS (alineados con el schema real) ─────────────────────────────────────
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
  active: boolean;
  experienceTitle?: string | null;
}

interface Settlement {
  id: number;
  platformId: number;
  platformName?: string | null;
  periodLabel: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  totalCoupons: number;
  totalAmount: string;
  status: "pendiente_cobro" | "cobrado";
  justificantUrl?: string | null;
  notes?: string | null;
  settledAt?: Date | null;
  createdAt: Date;
}

const FREQ_OPTIONS = [
  { value: "mensual", label: "Mensual" },
  { value: "quincenal", label: "Quincenal" },
  { value: "trimestral", label: "Trimestral" },
];

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

  // Product form
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<PlatformProduct | null>(null);
  const [productForm, setProductForm] = useState({
    externalProductName: "", externalLink: "", active: true,
  });

  // Settlement form
  const [settlementFormOpen, setSettlementFormOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const [settlementForm, setSettlementForm] = useState({
    periodLabel: "", periodFrom: "", periodTo: "",
    totalCoupons: 0, totalAmount: "0.00",
    status: "pendiente_cobro" as "pendiente_cobro" | "cobrado",
    justificantUrl: "", notes: "",
  });

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
    setProductForm({ externalProductName: "", externalLink: "", active: true });
    setProductFormOpen(true);
  };
  const openEditProduct = (p: PlatformProduct) => {
    setEditingProduct(p);
    setProductForm({ externalProductName: p.externalProductName ?? "", externalLink: p.externalLink ?? "", active: p.active });
    setProductFormOpen(true);
  };
  const openCreateSettlement = () => {
    setEditingSettlement(null);
    setSettlementForm({ periodLabel: "", periodFrom: "", periodTo: "", totalCoupons: 0, totalAmount: "0.00", status: "pendiente_cobro", justificantUrl: "", notes: "" });
    setSettlementFormOpen(true);
  };
  const openEditSettlement = (s: Settlement) => {
    setEditingSettlement(s);
    setSettlementForm({
      periodLabel: s.periodLabel, periodFrom: s.periodFrom ?? "", periodTo: s.periodTo ?? "",
      totalCoupons: s.totalCoupons, totalAmount: s.totalAmount,
      status: s.status, justificantUrl: s.justificantUrl ?? "", notes: s.notes ?? "",
    });
    setSettlementFormOpen(true);
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
              {platformsQuery.isLoading ? (
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
                        <p className="text-sm text-white/40">Productos de {selectedPlatform.name}</p>
                        <Button size="sm" variant="outline" onClick={openCreateProduct}
                          className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 h-8">
                          <Plus className="w-3.5 h-3.5 mr-1" /> Añadir producto
                        </Button>
                      </div>
                      <div className="rounded-xl border border-white/5 overflow-hidden">
                        {products.length === 0 ? (
                          <div className="p-8 text-center text-white/30 text-sm">
                            No hay productos configurados para esta plataforma.
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/[0.03]">
                                {["Producto", "Link externo", "Estado", ""].map((h, i) => (
                                  <th key={i} className="text-left px-4 py-3 text-white/40 font-medium text-xs">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {products.map((p) => (
                                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                                  <td className="px-4 py-3 text-white font-medium">
                                    {p.externalProductName ?? p.experienceTitle ?? "—"}
                                  </td>
                                  <td className="px-4 py-3">
                                    {p.externalLink ? (
                                      <a href={p.externalLink} target="_blank" rel="noreferrer"
                                        className="text-blue-400 hover:text-blue-300 text-xs flex items-center gap-1">
                                        <Globe className="w-3 h-3" /> Ver enlace
                                      </a>
                                    ) : <span className="text-white/30 text-xs">—</span>}
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
                              ))}
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
                        <p className="text-sm text-white/40">Liquidaciones de {selectedPlatform.name}</p>
                        <Button size="sm" variant="outline" onClick={openCreateSettlement}
                          className="border-white/10 bg-white/5 text-white/70 hover:bg-white/10 h-8">
                          <Plus className="w-3.5 h-3.5 mr-1" /> Nueva liquidación
                        </Button>
                      </div>
                      {settlements.length > 0 && (
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                            <p className="text-xs text-white/40">Total liquidaciones</p>
                            <p className="text-xl font-bold text-white">{settlements.length}</p>
                          </div>
                          <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                            <p className="text-xs text-white/40">Importe total</p>
                            <p className="text-xl font-bold text-white">
                              {settlements.reduce((s, l) => s + parseFloat(l.totalAmount), 0).toFixed(2)} €
                            </p>
                          </div>
                          <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                            <p className="text-xs text-white/40">Pendiente cobro</p>
                            <p className="text-xl font-bold text-amber-400">
                              {settlements.filter(s => s.status === "pendiente_cobro").reduce((a, l) => a + parseFloat(l.totalAmount), 0).toFixed(2)} €
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="rounded-xl border border-white/5 overflow-hidden">
                        {settlements.length === 0 ? (
                          <div className="p-8 text-center text-white/30 text-sm">
                            No hay liquidaciones registradas para esta plataforma.
                          </div>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/[0.03]">
                                {["Periodo", "Cupones", "Importe", "Estado", ""].map((h, i) => (
                                  <th key={i} className="text-left px-4 py-3 text-white/40 font-medium text-xs">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {settlements.map((s) => (
                                <tr key={s.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                                  <td className="px-4 py-3">
                                    <p className="text-white font-medium">{s.periodLabel}</p>
                                    {(s.periodFrom || s.periodTo) && (
                                      <p className="text-white/40 text-xs">{s.periodFrom} — {s.periodTo}</p>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-white">{s.totalCoupons}</td>
                                  <td className="px-4 py-3 text-white font-medium">{parseFloat(s.totalAmount).toFixed(2)} €</td>
                                  <td className="px-4 py-3">
                                    {s.status === "cobrado" ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                                        <CheckCircle className="w-3 h-3" /> Cobrado
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/15 text-amber-400 border-amber-500/30">
                                        <Clock className="w-3 h-3" /> Pendiente cobro
                                      </span>
                                    )}
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
                              ))}
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
              <Input
                value={platformForm.logoUrl}
                onChange={(e) => setPlatformForm(f => ({ ...f, logoUrl: e.target.value }))}
                placeholder="https://..."
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL del proveedor</Label>
              <Input
                value={platformForm.externalUrl}
                onChange={(e) => setPlatformForm(f => ({ ...f, externalUrl: e.target.value }))}
                placeholder="https://..."
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Frecuencia liquidación</Label>
                <Select
                  value={platformForm.settlementFrequency}
                  onValueChange={(v) => setPlatformForm(f => ({ ...f, settlementFrequency: v as "quincenal" | "mensual" | "trimestral" }))}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    {FREQ_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white/70 text-xs">Comisión (%)</Label>
                <Input
                  type="number" min={0} max={100} step={0.01}
                  value={platformForm.commissionPct}
                  onChange={(e) => setPlatformForm(f => ({ ...f, commissionPct: e.target.value }))}
                  placeholder="20.00"
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas</Label>
              <Textarea
                value={platformForm.notes}
                onChange={(e) => setPlatformForm(f => ({ ...f, notes: e.target.value }))}
                className="bg-white/5 border-white/10 text-white mt-1 resize-none"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPlatformForm(f => ({ ...f, active: !f.active }))}>
                {platformForm.active
                  ? <ToggleRight className="w-6 h-6 text-emerald-400" />
                  : <ToggleLeft className="w-6 h-6 text-white/30" />}
              </button>
              <span className="text-sm text-white/60">{platformForm.active ? "Activa" : "Inactiva"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlatformFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!platformForm.name || !platformForm.slug || createPlatform.isPending || updatePlatform.isPending}
              onClick={() => {
                const data = {
                  name: platformForm.name,
                  slug: platformForm.slug,
                  logoUrl: platformForm.logoUrl || undefined,
                  active: platformForm.active,
                  settlementFrequency: platformForm.settlementFrequency,
                  commissionPct: platformForm.commissionPct || undefined,
                  externalUrl: platformForm.externalUrl || undefined,
                  notes: platformForm.notes || undefined,
                };
                if (editingPlatform) updatePlatform.mutate({ id: editingPlatform.id, ...data });
                else createPlatform.mutate(data);
              }}
            >
              {editingPlatform ? "Guardar cambios" : "Crear plataforma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: PRODUCTO ───────────────────────────────────────────────── */}
      <Dialog open={productFormOpen} onOpenChange={setProductFormOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-400" />
              {editingProduct ? "Editar producto" : "Añadir producto"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-white/70 text-xs">Nombre del producto en la plataforma</Label>
              <Input
                value={productForm.externalProductName}
                onChange={(e) => setProductForm(f => ({ ...f, externalProductName: e.target.value }))}
                placeholder="Ej: Forfait día completo adulto"
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs">Link externo (en la plataforma)</Label>
              <Input
                value={productForm.externalLink}
                onChange={(e) => setProductForm(f => ({ ...f, externalLink: e.target.value }))}
                placeholder="https://..."
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setProductForm(f => ({ ...f, active: !f.active }))}>
                {productForm.active
                  ? <ToggleRight className="w-6 h-6 text-emerald-400" />
                  : <ToggleLeft className="w-6 h-6 text-white/30" />}
              </button>
              <span className="text-sm text-white/60">{productForm.active ? "Activo" : "Inactivo"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={createProduct.isPending || updateProduct.isPending}
              onClick={() => {
                if (!selectedPlatform) return;
                const data = {
                  platformId: selectedPlatform.id,
                  externalProductName: productForm.externalProductName || undefined,
                  externalLink: productForm.externalLink || undefined,
                  active: productForm.active,
                };
                if (editingProduct) updateProduct.mutate({ id: editingProduct.id, externalProductName: data.externalProductName, externalLink: data.externalLink, active: data.active });
                else createProduct.mutate(data);
              }}
            >
              {editingProduct ? "Guardar cambios" : "Añadir producto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: LIQUIDACIÓN ────────────────────────────────────────────── */}
      <Dialog open={settlementFormOpen} onOpenChange={setSettlementFormOpen}>
        <DialogContent className="bg-[#0f0f1a] border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-violet-400" />
              {editingSettlement ? "Editar liquidación" : "Nueva liquidación"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-white/70 text-xs">Etiqueta del periodo *</Label>
              <Input
                value={settlementForm.periodLabel}
                onChange={(e) => setSettlementForm(f => ({ ...f, periodLabel: e.target.value }))}
                placeholder="Ej: Enero 2026"
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Desde</Label>
                <Input
                  type="date" value={settlementForm.periodFrom}
                  onChange={(e) => setSettlementForm(f => ({ ...f, periodFrom: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Hasta</Label>
                <Input
                  type="date" value={settlementForm.periodTo}
                  onChange={(e) => setSettlementForm(f => ({ ...f, periodTo: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-white/70 text-xs">Nº cupones</Label>
                <Input
                  type="number" min={0}
                  value={settlementForm.totalCoupons}
                  onChange={(e) => setSettlementForm(f => ({ ...f, totalCoupons: parseInt(e.target.value) || 0 }))}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
              <div>
                <Label className="text-white/70 text-xs">Importe (€)</Label>
                <Input
                  type="number" min={0} step={0.01}
                  value={settlementForm.totalAmount}
                  onChange={(e) => setSettlementForm(f => ({ ...f, totalAmount: e.target.value }))}
                  className="bg-white/5 border-white/10 text-white mt-1"
                />
              </div>
            </div>
            <div>
              <Label className="text-white/70 text-xs">Estado</Label>
              <Select
                value={settlementForm.status}
                onValueChange={(v) => setSettlementForm(f => ({ ...f, status: v as "pendiente_cobro" | "cobrado" }))}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#1a1a2e] border-white/10">
                  <SelectItem value="pendiente_cobro">Pendiente de cobro</SelectItem>
                  <SelectItem value="cobrado">Cobrado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-white/70 text-xs">URL justificante</Label>
              <Input
                value={settlementForm.justificantUrl}
                onChange={(e) => setSettlementForm(f => ({ ...f, justificantUrl: e.target.value }))}
                placeholder="https://..."
                className="bg-white/5 border-white/10 text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/70 text-xs">Notas</Label>
              <Textarea
                value={settlementForm.notes}
                onChange={(e) => setSettlementForm(f => ({ ...f, notes: e.target.value }))}
                className="bg-white/5 border-white/10 text-white mt-1 resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementFormOpen(false)} className="border-white/10 text-white/70">Cancelar</Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700 text-white"
              disabled={!settlementForm.periodLabel || createSettlement.isPending || updateSettlement.isPending}
              onClick={() => {
                if (!selectedPlatform) return;
                if (editingSettlement) {
                  updateSettlement.mutate({
                    id: editingSettlement.id,
                    status: settlementForm.status,
                    totalCoupons: settlementForm.totalCoupons,
                    totalAmount: String(settlementForm.totalAmount),
                    justificantUrl: settlementForm.justificantUrl || undefined,
                    notes: settlementForm.notes || undefined,
                  });
                } else {
                  createSettlement.mutate({
                    platformId: selectedPlatform.id,
                    periodLabel: settlementForm.periodLabel,
                    periodFrom: settlementForm.periodFrom || undefined,
                    periodTo: settlementForm.periodTo || undefined,
                    totalCoupons: settlementForm.totalCoupons,
                    totalAmount: String(settlementForm.totalAmount),
                    notes: settlementForm.notes || undefined,
                  });
                }
              }}
            >
              {editingSettlement ? "Guardar cambios" : "Crear liquidación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
