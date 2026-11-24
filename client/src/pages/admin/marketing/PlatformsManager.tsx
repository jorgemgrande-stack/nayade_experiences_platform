/**
 * PlatformsManager — Gestión de Plataformas de Cupones
 * v23.2: Productos con PVP/neto/caducidad · Liquidaciones Pendiente/Emitida/Pagada
 * Diseño oscuro tipo CRM · Coherencia total con CuponesManager
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Link } from "wouter";
import { PanelPageHeader, PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { MetricCard, SegmentedTabs } from "@/components/admin/PanelVisual";
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
  Settings, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Package,
  Banknote, Globe, RefreshCw, ChevronRight, CheckCircle, Clock, ArrowLeft,
  Zap, AlertCircle, ExternalLink, CalendarDays, Euro, Eye, Download, FileText,
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

const SETTLEMENT_STATUS_CONFIG: Record<string, { label: string; tone: Tone; icon: typeof Clock }> = {
  pendiente: { label: "Pendiente", tone: "warning", icon: Clock },
  emitida:   { label: "Emitida",   tone: "info",    icon: Zap },
  pagada:    { label: "Pagada",    tone: "success", icon: CheckCircle },
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

type SettlementCouponRow = {
  id: number;
  couponCode: string | null;
  customerName: string;
  productName?: string | null;
  pvpPrice?: string | null;
  netPrice?: string | null;
  settledAt?: Date | string | null;
};

function downloadSettlementExcel(settlement: Settlement, platformName: string, coupons: SettlementCouponRow[]) {
  const totalPvp = coupons.reduce((s, c) => s + (c.pvpPrice ? parseFloat(c.pvpPrice) : 0), 0);
  const totalNet = coupons.reduce((s, c) => s + (c.netPrice ? parseFloat(c.netPrice) : 0), 0);
  const statusLabel: Record<string, string> = { pendiente: "Pendiente", emitida: "Emitida", pagada: "Pagada" };
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dataRows = coupons.map(c => `
    <tr>
      <td>${esc(c.couponCode ?? "")}</td>
      <td>${esc(c.customerName)}</td>
      <td>${esc(c.productName ?? "")}</td>
      <td>${c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-ES") : ""}</td>
      <td style="mso-number-format:'0.00'">${c.pvpPrice ? parseFloat(c.pvpPrice).toFixed(2) : ""}</td>
      <td style="mso-number-format:'0.00'">${c.netPrice ? parseFloat(c.netPrice).toFixed(2) : ""}</td>
    </tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<!--[if gte mso 9]><xml>
  <x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>Liquidaci&#xF3;n</x:Name>
  </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
<style>
  .meta td { color:#6b7280; font-size:11pt; }
  .hdr th { background:#7c3aed; color:#ffffff; font-weight:bold; font-size:11pt; padding:6px; }
  .total-row td { font-weight:bold; background:#f3f4f6; border-top:2px solid #d1d5db; }
  td, th { border:1px solid #e5e7eb; padding:5px 8px; font-size:11pt; }
</style>
</head>
<body>
<table>
  <tr class="meta"><td colspan="6"><b>Liquidación:</b> ${esc(settlement.periodLabel)}</td></tr>
  <tr class="meta"><td colspan="6"><b>Plataforma:</b> ${esc(platformName)}</td></tr>
  <tr class="meta"><td colspan="6"><b>Periodo:</b> ${settlement.periodFrom ?? "—"} – ${settlement.periodTo ?? "—"}</td></tr>
  <tr class="meta"><td colspan="6"><b>Estado:</b> ${statusLabel[settlement.status] ?? settlement.status}${settlement.invoiceRef ? ` &nbsp;|&nbsp; Ref: ${esc(settlement.invoiceRef)}` : ""}</td></tr>
  <tr><td colspan="6"></td></tr>
  <tr class="hdr">
    <th>Código</th><th>Cliente</th><th>Producto</th><th>Fecha canje</th><th>PVP (€)</th><th>Neto (€)</th>
  </tr>
  ${dataRows}
  <tr class="total-row">
    <td>TOTAL</td><td>${coupons.length} cupones</td><td></td><td></td>
    <td style="mso-number-format:'0.00'">${totalPvp.toFixed(2)}</td>
    <td style="mso-number-format:'0.00'">${totalNet.toFixed(2)}</td>
  </tr>
</table>
</body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liquidacion-${platformName.toLowerCase().replace(/\s+/g, "-")}-${settlement.periodLabel.toLowerCase().replace(/\s+/g, "-")}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadSettlementPDF(settlement: Settlement, platformName: string, coupons: SettlementCouponRow[]) {
  const totalPvp = coupons.reduce((s, c) => s + (c.pvpPrice ? parseFloat(c.pvpPrice) : 0), 0);
  const totalNet = coupons.reduce((s, c) => s + (c.netPrice ? parseFloat(c.netPrice) : 0), 0);
  const pct = totalPvp > 0 ? ((totalNet / totalPvp) * 100).toFixed(1) : "—";
  const statusLabel: Record<string, string> = { pendiente: "Pendiente", emitida: "Emitida", pagada: "Pagada" };
  const rows = coupons.map((c, i) => `
    <tr style="background:${i % 2 === 0 ? "#f9fafb" : "#fff"}">
      <td style="padding:7px 10px;font-family:monospace;font-size:12px;color:#7c3aed">${c.couponCode ?? "—"}</td>
      <td style="padding:7px 10px;font-size:13px">${c.customerName}</td>
      <td style="padding:7px 10px;font-size:12px;color:#6b7280">${c.productName ?? "—"}</td>
      <td style="padding:7px 10px;font-size:12px;color:#6b7280;text-align:center">${c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-ES") : "—"}</td>
      <td style="padding:7px 10px;font-size:13px;text-align:right">${c.pvpPrice ? parseFloat(c.pvpPrice).toFixed(2) + " €" : "—"}</td>
      <td style="padding:7px 10px;font-size:13px;font-weight:600;text-align:right;color:#059669">${c.netPrice ? parseFloat(c.netPrice).toFixed(2) + " €" : "—"}</td>
    </tr>`).join("");
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Liquidación ${settlement.periodLabel} — ${platformName}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif; padding:32px; color:#111; font-size:14px; }
    header { margin-bottom:24px; }
    header h1 { font-size:22px; font-weight:700; }
    header .meta { font-size:13px; color:#6b7280; margin-top:6px; }
    .summary { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:28px; }
    .card { border:1px solid #e5e7eb; border-radius:8px; padding:12px 16px; }
    .card .label { font-size:11px; color:#9ca3af; text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
    .card .val { font-size:22px; font-weight:700; }
    table { width:100%; border-collapse:collapse; }
    thead tr { background:#f3f4f6; }
    th { padding:9px 10px; text-align:left; font-size:11px; text-transform:uppercase; color:#6b7280; font-weight:600; border-bottom:2px solid #e5e7eb; }
    td { border-bottom:1px solid #f3f4f6; }
    tfoot td { padding:9px 10px; font-weight:700; border-top:2px solid #d1d5db; font-size:13px; background:#f9fafb; }
    @media print { @page { margin:1.5cm; } body { padding:0; } }
  </style>
</head>
<body>
  <header>
    <h1>Liquidación: ${settlement.periodLabel}</h1>
    <div class="meta">
      Plataforma: <strong>${platformName}</strong>
      ${settlement.periodFrom ? ` &nbsp;·&nbsp; Periodo: ${settlement.periodFrom} – ${settlement.periodTo ?? ""}` : ""}
      ${settlement.invoiceRef ? ` &nbsp;·&nbsp; Ref: <strong>${settlement.invoiceRef}</strong>` : ""}
      &nbsp;·&nbsp; Estado: <strong>${statusLabel[settlement.status] ?? settlement.status}</strong>
    </div>
  </header>
  <div class="summary">
    <div class="card"><div class="label">Cupones</div><div class="val">${coupons.length}</div></div>
    <div class="card"><div class="label">PVP Total</div><div class="val">${totalPvp.toFixed(2)} €</div></div>
    <div class="card" style="border-color:#d1fae5"><div class="label">Neto Total</div><div class="val" style="color:#059669">${totalNet.toFixed(2)} €</div></div>
    <div class="card" style="border-color:#ede9fe"><div class="label">% Neto / PVP</div><div class="val" style="color:#7c3aed">${pct}%</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Código</th><th>Cliente</th><th>Producto</th>
        <th style="text-align:center">Fecha canje</th>
        <th style="text-align:right">PVP</th><th style="text-align:right">Neto</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">TOTAL — ${coupons.length} cupones</td>
        <td style="text-align:right">${totalPvp.toFixed(2)} €</td>
        <td style="text-align:right;color:#059669">${totalNet.toFixed(2)} €</td>
      </tr>
    </tfoot>
  </table>
  ${settlement.notes ? `<p style="margin-top:24px;font-size:13px;color:#6b7280;padding-top:16px;border-top:1px solid #e5e7eb"><strong>Notas:</strong> ${settlement.notes}</p>` : ""}
  <p style="margin-top:32px;font-size:11px;color:#d1d5db;text-align:right">Generado el ${new Date().toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}</p>
</body>
</html>`;
  const win = window.open("", "_blank", "width=950,height=750");
  if (!win) { toast.error("No se pudo abrir la ventana de impresión. Permite ventanas emergentes."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
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
  const iconBtn = "h-9 w-9";
  return (
    <div
      className={`rounded-xl border shadow-sm transition-all ${
        isSelected
          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(platform)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {platform.logoUrl ? (
              <img src={platform.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-muted object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary" aria-hidden="true">
                {platform.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0">
              <span className="block break-words font-semibold text-foreground">{platform.name}</span>
              <span className="block text-xs text-muted-foreground">
                {FREQ_OPTIONS.find(f => f.value === platform.settlementFrequency)?.label ?? platform.settlementFrequency}
                {platform.commissionPct ? ` · ${platform.commissionPct}% comisión` : ""}
              </span>
            </span>
          </button>
          <div className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon" className={`${iconBtn} ${platform.active ? "text-success" : "text-muted-foreground"}`}
              aria-label={platform.active ? `Desactivar ${platform.name}` : `Activar ${platform.name}`} title={platform.active ? "Desactivar" : "Activar"}
              onClick={() => onToggle(platform.id, !platform.active)}>
              {platform.active ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}
            </Button>
            <Button type="button" variant="ghost" size="icon" className={iconBtn} aria-label={`Editar ${platform.name}`} title="Editar" onClick={() => onEdit(platform)}>
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={`${iconBtn} text-danger hover:text-danger`} aria-label={`Eliminar ${platform.name}`} title="Eliminar" onClick={() => onDelete(platform.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={platform.active ? "success" : "neutral"} icon={platform.active ? <CheckCircle /> : <Clock />}>
            {platform.active ? "Activa" : "Inactiva"}
          </StatusBadge>
          {platform.externalUrl && (
            <a
              href={platform.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-xs font-medium text-info hover:underline"
            >
              <Globe className="h-3 w-3" /> Web
            </a>
          )}
        </div>
        {isSelected && (
          <div className="flex items-center gap-1 text-xs text-primary">
            <ChevronRight className="h-3 w-3" /> Seleccionada: productos y liquidaciones a la derecha
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
  const productStatsQuery = trpc.ticketing.getProductStats.useQuery(
    { platformId: selectedPlatform?.id ?? 0 },
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
  const advanceSettlementStatus = trpc.ticketing.advanceSettlementStatus.useMutation({
    onSuccess: (data) => {
      const labels: Record<string, string> = { emitida: "Emitida", pagada: "Pagada" };
      toast.success(`Estado actualizado a: ${labels[data.newStatus] ?? data.newStatus}`);
      utils.ticketing.listSettlements.invalidate();
    },
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
  const productStats = productStatsQuery.data ?? {};

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

  // ── COLUMNAS DE LAS TABLAS (tabla desde 768 px, tarjetas en móvil) ────────────
  type ProductStat = { total: number; canjeados: number; pendientes: number; incidencias: number; anulados: number; pvpTotal: number; netoTotal: number; customerNames?: string[] };
  const statOf = (id: number) => (productStats as Record<number, ProductStat>)[id];
  const rowBtn = "h-9 w-9";
  const productColumns: PanelColumn<PlatformProduct>[] = [
    {
      key: "producto",
      header: "Producto",
      cell: (p) => (
        <div className="min-w-0">
          <p className="break-words text-sm font-medium text-foreground">{p.externalProductName ?? p.experienceTitle ?? "—"}</p>
          {p.experienceTitle && p.externalProductName && <p className="text-xs font-normal text-muted-foreground">→ {p.experienceTitle}</p>}
          {p.externalLink && (
            <a href={p.externalLink} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs font-normal text-info hover:underline">
              <ExternalLink className="h-3 w-3" /> Ver en plataforma
            </a>
          )}
        </div>
      ),
    },
    {
      key: "precios",
      header: "PVP / Neto",
      cell: (p) => (
        <div className="space-y-0.5 text-sm md:text-left">
          {p.pvpPrice ? <p className="font-semibold text-foreground">{parseFloat(p.pvpPrice).toFixed(2)} €</p> : <p className="text-xs text-muted-foreground">Sin PVP</p>}
          {p.netPrice && <p className="text-xs font-medium text-success">Neto {parseFloat(p.netPrice).toFixed(2)} €</p>}
        </div>
      ),
    },
    {
      key: "caduca",
      header: "Caduca",
      cell: (p) => {
        const expired = isExpired(p.expiresAt);
        const expiring = isExpiringSoon(p.expiresAt);
        if (!p.expiresAt) return <span className="text-xs text-muted-foreground">Sin caducidad</span>;
        return (
          <StatusBadge tone={expired ? "danger" : expiring ? "warning" : "neutral"} icon={expired ? <AlertCircle /> : expiring ? <Clock /> : <CalendarDays />}>
            {formatDate(p.expiresAt)}
          </StatusBadge>
        );
      },
    },
    { key: "estado", header: "Estado", cell: (p) => <StatusBadge tone={p.active ? "success" : "neutral"}>{p.active ? "Activo" : "Inactivo"}</StatusBadge> },
    {
      key: "cupones",
      header: "Cupones",
      cell: (p) => {
        const st = statOf(p.id);
        return (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs md:justify-start">
            <span className="text-info" title="Cupones recibidos"><strong>{st?.total ?? 0}</strong> recib.</span>
            <span className="text-success" title="Cupones canjeados"><strong>{st?.canjeados ?? 0}</strong> canj.</span>
            <span className="text-warning" title="Cupones aparcados / pendientes"><strong>{st?.pendientes ?? 0}</strong> apar.</span>
            <span className="text-danger" title="Cupones con incidencia"><strong>{st?.incidencias ?? 0}</strong> inc.</span>
          </div>
        );
      },
    },
    {
      key: "importes",
      header: "PVP gen. / Neto obt.",
      cell: (p) => {
        const st = statOf(p.id);
        return st ? (
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold text-primary" title="PVP generado (suma de precios PVP de cupones no incidencia)">{st.pvpTotal.toFixed(2)} €</p>
            <p className="font-semibold text-success" title="Precio neto obtenido (suma de neto de cupones canjeados)">{st.netoTotal.toFixed(2)} €</p>
          </div>
        ) : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      key: "clientes",
      header: "Clientes",
      cell: (p) => {
        const st = statOf(p.id);
        return st?.customerNames && st.customerNames.length > 0 ? (
          <div className="flex max-w-[190px] flex-wrap gap-1 md:justify-start">
            {st.customerNames.slice(0, 3).map((name, i) => (
              <span key={i} className="inline-flex max-w-[90px] items-center overflow-hidden text-ellipsis whitespace-nowrap rounded border border-border bg-muted/50 px-1.5 py-0.5 text-xs font-normal text-foreground" title={name}>{name}</span>
            ))}
            {st.customerNames.length > 3 && <span className="inline-flex items-center rounded border border-border bg-muted/50 px-1.5 py-0.5 text-xs font-normal text-muted-foreground">+{st.customerNames.length - 3}</span>}
          </div>
        ) : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cell: (p) => (
        <div className="flex items-center justify-end gap-0.5">
          <Button type="button" variant="ghost" size="icon" className={rowBtn} aria-label="Editar producto" title="Editar" onClick={() => openEditProduct(p)}><Edit2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className={`${rowBtn} text-danger hover:text-danger`} aria-label="Eliminar producto" title="Eliminar"
            onClick={async () => { if ((await confirmAction({ description: "¿Eliminar este producto?", destructive: true }))) deleteProduct.mutate({ id: p.id }); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];
  const settlementColumns: PanelColumn<Settlement>[] = [
    {
      key: "periodo",
      header: "Periodo",
      cell: (s) => (
        <div>
          <p className="text-sm font-medium text-foreground">{s.periodLabel}</p>
          {(s.periodFrom || s.periodTo) && <p className="text-xs font-normal text-muted-foreground">{formatDate(s.periodFrom)} — {formatDate(s.periodTo)}</p>}
          {s.invoiceRef && <p className="text-xs font-normal text-primary">Ref: {s.invoiceRef}</p>}
        </div>
      ),
    },
    {
      key: "cupones",
      header: "Cupones",
      cell: (s) => (
        <button type="button" onClick={() => setDetailSettlement(s)} className="font-medium text-foreground underline decoration-dotted underline-offset-2 hover:text-primary" aria-label={`Ver los ${s.totalCoupons} cupones de ${s.periodLabel}`}>
          {s.totalCoupons}
        </button>
      ),
    },
    { key: "pvp", header: "PVP total", cell: (s) => <span className="font-medium text-foreground">{parseFloat(s.totalAmount).toFixed(2)} €</span> },
    { key: "neto", header: "Neto", cell: (s) => <span className="font-semibold text-success">{parseFloat(s.netTotal ?? "0").toFixed(2)} €</span> },
    {
      key: "estado",
      header: "Estado",
      cell: (s) => {
        const cfg = SETTLEMENT_STATUS_CONFIG[s.status] ?? SETTLEMENT_STATUS_CONFIG.pendiente;
        const Icon = cfg.icon;
        return <StatusBadge tone={cfg.tone} icon={<Icon />}>{cfg.label}</StatusBadge>;
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cell: (s) => (
        <div className="flex flex-wrap items-center justify-end gap-0.5">
          {/* Botón de avance directo de estado */}
          {s.status !== "pagada" && (
            <Button type="button" size="sm" variant="outline" disabled={advanceSettlementStatus.isPending}
              className={s.status === "pendiente" ? "border-info/40 text-info hover:text-info" : "border-success/40 text-success hover:text-success"}
              title={s.status === "pendiente" ? "Marcar como Emitida" : "Marcar como Pagada"}
              onClick={() => advanceSettlementStatus.mutate({ id: s.id })}>
              {s.status === "pendiente" ? "→ Emitida" : "→ Pagada"}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className={rowBtn} aria-label="Ver detalle de operaciones" title="Ver detalle de operaciones" onClick={() => setDetailSettlement(s)}><Eye className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className={rowBtn} aria-label="Editar liquidación" title="Editar" onClick={() => openEditSettlement(s)}><Edit2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className={`${rowBtn} text-danger hover:text-danger`} aria-label="Eliminar liquidación" title="Eliminar"
            onClick={async () => { if ((await confirmAction({ description: "¿Eliminar esta liquidación?", destructive: true }))) deleteSettlement.mutate({ id: s.id }); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  /** En pantallas estrechas el detalle va debajo de la lista: al elegir una plataforma se lleva a la vista. */
  const selectPlatform = (p: Platform) => {
    setSelectedPlatform(p);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      window.setTimeout(() => document.getElementById("plataforma-detalle")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };
  const activeProducts = products.filter((p) => p.active).length;
  const activePlatforms = platforms.filter((p) => p.active).length;

  return (
    <AdminLayout>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">

          {/* ── HEADER ─────────────────────────────────────────────────────── */}
          <PanelPageHeader
            className="mb-0"
            icon={<Settings />}
            title="Plataformas de Cupones"
            description="Configura proveedores, productos y liquidaciones"
            actions={<>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/marketing/cupones"><ArrowLeft className="mr-1 h-4 w-4" /> Cupones</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => utils.ticketing.listPlatforms.invalidate()}>
                <RefreshCw className="mr-1 h-4 w-4" /> Actualizar
              </Button>
              <Button size="sm" onClick={openCreatePlatform}>
                <Plus className="mr-1 h-4 w-4" /> Nueva plataforma
              </Button>
            </>}
          />

          {/* ── RESUMEN ──────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard tone="brand" icon={<Settings />} label="Plataformas" value={platforms.length} className="bg-gradient-to-br from-primary/5 to-card" />
            <MetricCard tone="success" icon={<CheckCircle />} label="Activas" value={activePlatforms} detail={`${platforms.length - activePlatforms} inactivas`} className="bg-gradient-to-br from-success/10 to-card" />
            <MetricCard tone="info" icon={<Package />} label="Productos activos" value={selectedPlatform ? activeProducts : "—"} detail={selectedPlatform ? selectedPlatform.name : "Elige una plataforma"} className="bg-gradient-to-br from-info/10 to-card" />
            <MetricCard tone="warning" icon={<Banknote />} label="Neto por liquidar" value={selectedPlatform ? `${settlementStats.pendienteNet.toFixed(2)} €` : "—"} detail={selectedPlatform ? `${settlementStats.pendiente + settlementStats.emitida} liquidaciones sin pagar` : "Elige una plataforma"} className="bg-gradient-to-br from-warning/10 to-card" />
          </div>

          {/* ── LAYOUT ───────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

            {/* Lista de plataformas */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">
                Plataformas ({platforms.length})
              </h2>
              {platformsQuery.isPending ? (
                <PanelLoading />
              ) : platformsQuery.error ? (
                <PanelError error={platformsQuery.error} onRetry={() => void platformsQuery.refetch()} title="No se han podido cargar las plataformas" />
              ) : platforms.length === 0 ? (
                <PanelEmpty icon={<Settings />} title="Aún no hay plataformas" description="Da de alta Groupon, Smartbox u otra para gestionar sus productos y liquidaciones.">
                  <Button size="sm" onClick={openCreatePlatform}><Plus className="mr-1 h-4 w-4" /> Nueva plataforma</Button>
                </PanelEmpty>
              ) : platforms.map((p) => (
                <PlatformCard
                  key={p.id}
                  platform={p}
                  onEdit={openEditPlatform}
                  onToggle={(id, active) => togglePlatform.mutate({ id, active })}
                  onDelete={async (id) => {
                    if ((await confirmAction({ description: "¿Eliminar esta plataforma? Se eliminarán también sus productos.", destructive: true }))) {
                      deletePlatform.mutate({ id });
                    }
                  }}
                  onSelect={selectPlatform}
                  isSelected={selectedPlatform?.id === p.id}
                />
              ))}
            </div>

            {/* Panel de detalle */}
            <div id="plataforma-detalle" className="min-w-0 scroll-mt-20 lg:col-span-2">
              {!selectedPlatform ? (
                <PanelEmpty icon={<Settings />} title="Selecciona una plataforma" description="Verás sus productos con precios y caducidad, y sus liquidaciones." />
              ) : (
                <div className="space-y-4">
                  {/* Cabecera plataforma seleccionada */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {selectedPlatform.logoUrl ? (
                        <img src={selectedPlatform.logoUrl} alt="" className="h-9 w-9 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-sm font-bold text-primary" aria-hidden="true">
                          {selectedPlatform.name.charAt(0)}
                        </span>
                      )}
                      <h2 className="min-w-0 break-words text-lg font-semibold text-foreground">{selectedPlatform.name}</h2>
                    </div>
                    <SegmentedTabs<"productos" | "liquidaciones">
                      label="Sección de la plataforma"
                      value={activeSection}
                      onChange={setActiveSection}
                      options={[
                        { value: "productos", label: "Productos", count: products.length },
                        { value: "liquidaciones", label: "Liquidaciones", count: settlements.length },
                      ]}
                    />
                  </div>

                  {/* ── PRODUCTOS ──────────────────────────────────────────── */}
                  {activeSection === "productos" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                          Productos de <span className="text-foreground">{selectedPlatform.name}</span>
                          {" "}— {activeProducts} activos
                        </p>
                        <Button size="sm" variant="outline" onClick={openCreateProduct}>
                          <Plus className="mr-1 h-3.5 w-3.5" /> Añadir producto
                        </Button>
                      </div>
                      {productsQuery.isPending ? (
                        <PanelLoading />
                      ) : productsQuery.error ? (
                        <PanelError error={productsQuery.error} onRetry={() => void productsQuery.refetch()} title="No se han podido cargar los productos" />
                      ) : products.length === 0 ? (
                        <PanelEmpty icon={<Package />} title="Sin productos configurados" description="Añade los productos que vende esta plataforma con su PVP, precio neto y caducidad.">
                          <Button size="sm" onClick={openCreateProduct}><Plus className="mr-1 h-4 w-4" /> Añadir producto</Button>
                        </PanelEmpty>
                      ) : (
                        <PanelDataList rows={products} columns={productColumns} rowKey={(p) => p.id} caption={`Productos de ${selectedPlatform.name}`} />
                      )}
                    </div>
                  )}

                  {/* ── LIQUIDACIONES ──────────────────────────────────────── */}
                  {activeSection === "liquidaciones" && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">Liquidaciones de <span className="text-foreground">{selectedPlatform.name}</span></p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" className="border-primary/40 text-primary hover:text-primary" onClick={() => {
                            setGenerateForm({ periodLabel: "", periodFrom: "", periodTo: "", notes: "" });
                            setGenerateModalOpen(true);
                          }}>
                            <Zap className="mr-1 h-3.5 w-3.5" /> Generar automática
                          </Button>
                          <Button size="sm" variant="outline" onClick={openCreateSettlement}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> Manual
                          </Button>
                        </div>
                      </div>

                      {/* Stats de liquidaciones */}
                      {settlements.length > 0 && (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <MetricCard compact tone="neutral" icon={<FileText />} label="Total" value={settlementStats.total} />
                          <MetricCard compact tone="warning" icon={<Clock />} label="Pendientes" value={settlementStats.pendiente} />
                          <MetricCard compact tone="info" icon={<Zap />} label="Emitidas" value={settlementStats.emitida} />
                          <MetricCard compact tone="success" icon={<Banknote />} label="Neto pendiente" value={`${settlementStats.pendienteNet.toFixed(2)} €`} />
                        </div>
                      )}

                      {settlementsQuery.isPending ? (
                        <PanelLoading />
                      ) : settlementsQuery.error ? (
                        <PanelError error={settlementsQuery.error} onRetry={() => void settlementsQuery.refetch()} title="No se han podido cargar las liquidaciones" />
                      ) : settlements.length === 0 ? (
                        <PanelEmpty icon={<Banknote />} title="Sin liquidaciones" description="Genera una liquidación automática del periodo o créala a mano para esta plataforma." />
                      ) : (
                        <PanelDataList rows={settlements} columns={settlementColumns} rowKey={(s) => s.id} caption={`Liquidaciones de ${selectedPlatform.name}`} />
                      )}
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
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-primary" />
              {editingPlatform ? "Editar plataforma" : "Nueva plataforma"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-foreground/70 text-xs">Nombre *</Label>
              <Input
                value={platformForm.name}
                onChange={(e) => setPlatformForm(f => ({ ...f, name: e.target.value, slug: editingPlatform ? f.slug : slugify(e.target.value) }))}
                placeholder="Ej: Groupon"
                className="bg-muted/50 border-border text-foreground mt-1"
              />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Slug (identificador único) *</Label>
              <Input
                value={platformForm.slug}
                onChange={(e) => setPlatformForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                placeholder="groupon"
                className="bg-muted/50 border-border text-foreground mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">URL del logo</Label>
              <Input value={platformForm.logoUrl} onChange={(e) => setPlatformForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">URL del proveedor</Label>
              <Input value={platformForm.externalUrl} onChange={(e) => setPlatformForm(f => ({ ...f, externalUrl: e.target.value }))} placeholder="https://..." className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Frecuencia liquidación</Label>
                <Select value={platformForm.settlementFrequency} onValueChange={(v) => setPlatformForm(f => ({ ...f, settlementFrequency: v as "quincenal" | "mensual" | "trimestral" }))}>
                  <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {FREQ_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Comisión (%)</Label>
                <Input type="number" min={0} max={100} step={0.01} value={platformForm.commissionPct} onChange={(e) => setPlatformForm(f => ({ ...f, commissionPct: e.target.value }))} placeholder="20.00" className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Notas</Label>
              <Textarea value={platformForm.notes} onChange={(e) => setPlatformForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={2} />
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPlatformForm(f => ({ ...f, active: !f.active }))}>
                {platformForm.active ? <ToggleRight className="w-6 h-6 text-success" /> : <ToggleLeft className="w-6 h-6 text-muted-foreground" />}
              </button>
              <span className="text-sm text-foreground/60">{platformForm.active ? "Activa" : "Inactiva"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlatformFormOpen(false)} className="border-border text-foreground/70">Cancelar</Button>
            <Button 
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
        <DialogContent className="bg-background border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              {editingProduct ? "Editar producto" : "Añadir producto"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-foreground/70 text-xs">Nombre del producto en la plataforma *</Label>
              <Input value={productForm.externalProductName} onChange={(e) => setProductForm(f => ({ ...f, externalProductName: e.target.value }))} placeholder="Ej: Forfait día completo adulto" className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">URL del producto en la plataforma</Label>
              <Input value={productForm.externalLink} onChange={(e) => setProductForm(f => ({ ...f, externalLink: e.target.value }))} placeholder="https://www.groupon.es/deals/..." className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs flex items-center gap-1"><Euro className="w-3 h-3" /> Precio PVP (€)</Label>
                <Input type="number" min={0} step={0.01} value={productForm.pvpPrice} onChange={(e) => setProductForm(f => ({ ...f, pvpPrice: e.target.value }))} placeholder="45.00" className="bg-muted/50 border-border text-foreground mt-1" />
                <p className="text-muted-foreground text-xs mt-1">Precio de venta al público</p>
              </div>
              <div>
                <Label className="text-foreground/70 text-xs flex items-center gap-1 text-success/80"><Euro className="w-3 h-3" /> Precio neto (€)</Label>
                <Input type="number" min={0} step={0.01} value={productForm.netPrice} onChange={(e) => setProductForm(f => ({ ...f, netPrice: e.target.value }))} placeholder="36.00" className="bg-muted/50 border-border text-foreground mt-1" />
                <p className="text-muted-foreground text-xs mt-1">Lo que nos paga el proveedor</p>
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Fecha de caducidad del producto</Label>
              <Input type="date" value={productForm.expiresAt} onChange={(e) => setProductForm(f => ({ ...f, expiresAt: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              <p className="text-muted-foreground text-xs mt-1">Dejar vacío si no tiene caducidad</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setProductForm(f => ({ ...f, active: !f.active }))}>
                {productForm.active ? <ToggleRight className="w-6 h-6 text-success" /> : <ToggleLeft className="w-6 h-6 text-muted-foreground" />}
              </button>
              <span className="text-sm text-foreground/60">{productForm.active ? "Activo — aparece en el selector de conversión" : "Inactivo — no aparece en el selector"}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProductFormOpen(false)} className="border-border text-foreground/70">Cancelar</Button>
            <Button 
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
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-primary" />
              {editingSettlement ? "Editar liquidación" : "Nueva liquidación manual"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-foreground/70 text-xs">Etiqueta del periodo *</Label>
              <Input value={settlementForm.periodLabel} onChange={(e) => setSettlementForm(f => ({ ...f, periodLabel: e.target.value }))} placeholder="Ej: Enero 2026" className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Desde</Label>
                <Input type="date" value={settlementForm.periodFrom} onChange={(e) => setSettlementForm(f => ({ ...f, periodFrom: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Hasta</Label>
                <Input type="date" value={settlementForm.periodTo} onChange={(e) => setSettlementForm(f => ({ ...f, periodTo: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Nº cupones</Label>
                <Input type="number" min={0} value={settlementForm.totalCoupons} onChange={(e) => setSettlementForm(f => ({ ...f, totalCoupons: parseInt(e.target.value) || 0 }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Importe PVP (€)</Label>
                <Input type="number" min={0} step={0.01} value={settlementForm.totalAmount} onChange={(e) => setSettlementForm(f => ({ ...f, totalAmount: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs text-success/80">Importe neto a cobrar (€)</Label>
              <Input type="number" min={0} step={0.01} value={settlementForm.netTotal} onChange={(e) => setSettlementForm(f => ({ ...f, netTotal: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Estado</Label>
              <Select value={settlementForm.status} onValueChange={(v) => setSettlementForm(f => ({ ...f, status: v as "pendiente" | "emitida" | "pagada" }))}>
                <SelectTrigger className="bg-muted/50 border-border text-foreground mt-1"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="pendiente">Pendiente de cobro</SelectItem>
                  <SelectItem value="emitida">Emitida (factura enviada)</SelectItem>
                  <SelectItem value="pagada">Pagada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Referencia factura</Label>
              <Input value={settlementForm.invoiceRef} onChange={(e) => setSettlementForm(f => ({ ...f, invoiceRef: e.target.value }))} placeholder="FAC-2026-001" className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">URL justificante</Label>
              <Input value={settlementForm.justificantUrl} onChange={(e) => setSettlementForm(f => ({ ...f, justificantUrl: e.target.value }))} placeholder="https://..." className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Notas</Label>
              <Textarea value={settlementForm.notes} onChange={(e) => setSettlementForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettlementFormOpen(false)} className="border-border text-foreground/70">Cancelar</Button>
            <Button 
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
        <DialogContent className="bg-background border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Generar liquidación automática
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
              Agrupa automáticamente todos los cupones <strong>canjeados</strong> de <strong>{selectedPlatform?.name}</strong> en el periodo seleccionado que aún no tengan liquidación asignada.
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Etiqueta del periodo *</Label>
              <Input value={generateForm.periodLabel} onChange={(e) => setGenerateForm(f => ({ ...f, periodLabel: e.target.value }))} placeholder="Ej: Enero 2026" className="bg-muted/50 border-border text-foreground mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/70 text-xs">Desde *</Label>
                <Input type="date" value={generateForm.periodFrom} onChange={(e) => setGenerateForm(f => ({ ...f, periodFrom: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
              <div>
                <Label className="text-foreground/70 text-xs">Hasta *</Label>
                <Input type="date" value={generateForm.periodTo} onChange={(e) => setGenerateForm(f => ({ ...f, periodTo: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1" />
              </div>
            </div>
            <div>
              <Label className="text-foreground/70 text-xs">Notas</Label>
              <Textarea value={generateForm.notes} onChange={(e) => setGenerateForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted/50 border-border text-foreground mt-1 resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateModalOpen(false)} className="border-border text-foreground/70">Cancelar</Button>
            <Button 
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

      {/* ── MODAL: DETALLE OPERACIONES DE LIQUIDACIÓN ─────────────────────── */}
      <Dialog open={!!detailSettlement} onOpenChange={(o) => { if (!o) setDetailSettlement(null); }}>
        <DialogContent className="bg-background border-border text-foreground max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-primary" />
              Detalle de operaciones — {detailSettlement?.periodLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Summary cards */}
            {detailSettlement && (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-border/50 bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">Cupones</p>
                  <p className="text-2xl font-bold text-foreground">{detailSettlement.totalCoupons}</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">PVP Total</p>
                  <p className="text-2xl font-bold text-foreground">{parseFloat(detailSettlement.totalAmount).toFixed(2)} €</p>
                </div>
                <div className="rounded-lg border border-success/20 bg-success/5 p-3">
                  <p className="text-xs text-success/70">Neto Total</p>
                  <p className="text-2xl font-bold text-success">{parseFloat(detailSettlement.netTotal ?? "0").toFixed(2)} €</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Estado</p>
                  {(() => {
                    const cfg = SETTLEMENT_STATUS_CONFIG[detailSettlement.status] ?? SETTLEMENT_STATUS_CONFIG.pendiente;
                    const Icon = cfg.icon;
                    return <StatusBadge tone={cfg.tone} icon={<Icon />}>{cfg.label}</StatusBadge>;
                  })()}
                  {detailSettlement.invoiceRef && (
                    <p className="text-primary text-xs mt-1">Ref: {detailSettlement.invoiceRef}</p>
                  )}
                </div>
              </div>
            )}

            {/* Coupon table */}
            {settlementCouponsQuery.isPending ? (
              <div className="text-center text-muted-foreground py-8">Cargando operaciones...</div>
            ) : (settlementCouponsQuery.data?.length ?? 0) === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">No hay cupones vinculados a esta liquidación.</div>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/40">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs">Código</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs">Cliente</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs">Producto</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium text-xs">Fecha canje</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium text-xs">PVP</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium text-xs">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(settlementCouponsQuery.data ?? []).map((c: SettlementCouponRow) => (
                      <tr key={c.id} className="border-b border-border/50 hover:bg-muted/50">
                        <td className="px-4 py-3 font-mono text-primary text-xs">{c.couponCode ?? "—"}</td>
                        <td className="px-4 py-3 text-foreground text-sm">{c.customerName}</td>
                        <td className="px-4 py-3 text-foreground/60 text-xs">{c.productName ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-ES") : "—"}</td>
                        <td className="px-4 py-3 text-foreground text-sm text-right">{c.pvpPrice ? `${parseFloat(c.pvpPrice).toFixed(2)} €` : "—"}</td>
                        <td className="px-4 py-3 text-success font-semibold text-sm text-right">{c.netPrice ? `${parseFloat(c.netPrice).toFixed(2)} €` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/40 border-t border-border">
                      <td colSpan={4} className="px-4 py-2 text-muted-foreground text-xs font-medium">
                        TOTAL — {settlementCouponsQuery.data?.length ?? 0} operaciones
                      </td>
                      <td className="px-4 py-2 text-foreground font-semibold text-sm text-right">
                        {(settlementCouponsQuery.data as SettlementCouponRow[] ?? []).reduce((s, c) => s + (c.pvpPrice ? parseFloat(c.pvpPrice) : 0), 0).toFixed(2)} €
                      </td>
                      <td className="px-4 py-2 text-success font-bold text-sm text-right">
                        {(settlementCouponsQuery.data as SettlementCouponRow[] ?? []).reduce((s, c) => s + (c.netPrice ? parseFloat(c.netPrice) : 0), 0).toFixed(2)} €
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setDetailSettlement(null)} className="border-border text-foreground/70 mr-auto">
              Cerrar
            </Button>
            {(settlementCouponsQuery.data?.length ?? 0) > 0 && detailSettlement && (
              <>
                <Button
                  variant="outline"
                  onClick={() => downloadSettlementExcel(
                    detailSettlement,
                    selectedPlatform?.name ?? detailSettlement.platformName ?? "Plataforma",
                    settlementCouponsQuery.data as SettlementCouponRow[]
                  )}
                  className="border-success/30 bg-success/10 text-success hover:bg-success/20"
                >
                  <Download className="w-4 h-4 mr-1.5" /> Descargar Excel (.xls)
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadSettlementPDF(
                    detailSettlement,
                    selectedPlatform?.name ?? detailSettlement.platformName ?? "Plataforma",
                    settlementCouponsQuery.data as SettlementCouponRow[]
                  )}
                  className="border-danger/30 bg-danger/10 text-danger hover:bg-danger/20"
                >
                  <FileText className="w-4 h-4 mr-1.5" /> Descargar PDF
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
