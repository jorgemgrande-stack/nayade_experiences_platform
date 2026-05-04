import React, { useState, useMemo, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import CancellationDetailModal from "./CancellationDetailModal";
import { ProposalLeadButton } from "./ProposalsManager";
import { CatalogConceptSelector, type CatalogProduct } from "@/components/CatalogConceptSelector";
import {
  Users,
  User,
  FileText,
  CalendarCheck,
  Calendar,
  CalendarClock,
  TrendingUp,
  Search,
  Plus,
  Eye,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Star,
  Phone,
  Mail,
  MessageSquare,
  ChevronRight,
  AlertTriangle,
  Download,
  RefreshCw,
  Trash2,
  Copy,
  Filter,
  ArrowUpRight,
  Banknote,
  Pencil,
  FileDown,
  Sparkles,
  Receipt,
  CreditCard,
  Upload,
  RotateCcw,
  Ban,
  Paperclip,
  MoreVertical,
  ExternalLink,
  FilePlus,
  CloudLightning,
  HeartPulse,
  HelpCircle,
  CheckCircle2,
  FileQuestion,
  Gift,
  AlertCircle,
  Archive,
  X,
  CalendarDays,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Tab = "leads" | "quotes" | "reservations" | "invoices" | "anulaciones" | "pagos_pendientes" | "bonos";

type OpportunityStatus = "nueva" | "enviada" | "ganada" | "perdida";
type Priority = "baja" | "media" | "alta";
type QuoteStatus = "borrador" | "enviado" | "visualizado" | "convertido_carrito" | "pago_fallido" | "aceptado" | "rechazado" | "expirado" | "perdido";

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────

function OpportunityBadge({ status }: { status: OpportunityStatus }) {
  const map: Record<OpportunityStatus, { label: string; className: string }> = {
    nueva: { label: "Nueva", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    enviada: { label: "Enviada", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    ganada: { label: "Ganada", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    perdida: { label: "Perdida", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { label, className } = map[status] ?? map.nueva;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{label}</span>;
}

function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const map: Record<QuoteStatus, { label: string; className: string }> = {
    borrador:           { label: "Borrador",         className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    enviado:            { label: "Enviado",           className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    visualizado:        { label: "Visualizado",       className: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
    convertido_carrito: { label: "Pago iniciado",     className: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
    pago_fallido:       { label: "Pago fallido",      className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    aceptado:           { label: "Aceptado",          className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    rechazado:          { label: "Rechazado",         className: "bg-red-500/15 text-red-400 border-red-500/30" },
    expirado:           { label: "Expirado",          className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    perdido:            { label: "Perdido",           className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { label, className } = map[status] ?? { label: status, className: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${className}`}>{label}</span>;
}

function PriorityDot({ priority }: { priority: Priority }) {
  const map: Record<Priority, string> = {
    baja: "bg-slate-400",
    media: "bg-amber-400",
    alta: "bg-red-400",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[priority] ?? "bg-slate-400"}`} title={priority} />;
}

// ─// ─── COUNTER CARD ─────────────────────────────────────────────────────

// Count-up animation hook
function useCountUp(target: number, duration = 800) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (target === 0) { setCount(0); return; }
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return count;
}

const COUNTER_STYLES = {
  blue: {
    bg: "bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/80 dark:via-blue-900/40 dark:to-[#080e1c]",
    border: "border-blue-200 dark:border-blue-500/30",
    activeBorder: "border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.35)]",
    glow: "bg-blue-500/10",
    icon: "text-blue-600 dark:text-blue-400",
    number: "text-blue-700 dark:text-blue-300",
    label: "text-blue-600/70 dark:text-blue-300/70",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  amber: {
    bg: "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/80 dark:via-amber-900/30 dark:to-[#080e1c]",
    border: "border-amber-200 dark:border-amber-500/30",
    activeBorder: "border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.35)]",
    glow: "bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-400",
    number: "text-amber-700 dark:text-amber-300",
    label: "text-amber-600/70 dark:text-amber-300/70",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  green: {
    bg: "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/80 dark:via-emerald-900/30 dark:to-[#080e1c]",
    border: "border-emerald-200 dark:border-emerald-500/30",
    activeBorder: "border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]",
    glow: "bg-emerald-500/10",
    icon: "text-emerald-600 dark:text-emerald-400",
    number: "text-emerald-700 dark:text-emerald-300",
    label: "text-emerald-600/70 dark:text-emerald-300/70",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  red: {
    bg: "bg-gradient-to-br from-red-50 to-white dark:from-red-950/80 dark:via-red-900/30 dark:to-[#080e1c]",
    border: "border-red-200 dark:border-red-500/30",
    activeBorder: "border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.35)]",
    glow: "bg-red-500/10",
    icon: "text-red-600 dark:text-red-400",
    number: "text-red-700 dark:text-red-300",
    label: "text-red-600/70 dark:text-red-300/70",
    dot: "bg-red-500 dark:bg-red-400",
  },
  slate: {
    bg: "bg-gradient-to-br from-slate-50 to-white dark:from-slate-800/80 dark:via-slate-700/30 dark:to-[#080e1c]",
    border: "border-slate-200 dark:border-slate-500/30",
    activeBorder: "border-slate-400 shadow-[0_0_20px_rgba(148,163,184,0.25)]",
    glow: "bg-slate-500/10",
    icon: "text-slate-600 dark:text-slate-400",
    number: "text-slate-700 dark:text-slate-300",
    label: "text-slate-600/70 dark:text-slate-300/70",
    dot: "bg-slate-500 dark:bg-slate-400",
  },
  orange: {
    bg: "bg-gradient-to-br from-orange-50 to-white dark:from-orange-950/80 dark:via-orange-900/30 dark:to-[#080e1c]",
    border: "border-orange-200 dark:border-orange-500/30",
    activeBorder: "border-orange-400 shadow-[0_0_20px_rgba(249,115,22,0.35)]",
    glow: "bg-orange-500/10",
    icon: "text-orange-600 dark:text-orange-400",
    number: "text-orange-700 dark:text-orange-300",
    label: "text-orange-600/70 dark:text-orange-300/70",
    dot: "bg-orange-500 dark:bg-orange-400",
  },
  indigo: {
    bg: "bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/80 dark:via-indigo-900/30 dark:to-[#080e1c]",
    border: "border-indigo-200 dark:border-indigo-500/30",
    activeBorder: "border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.35)]",
    glow: "bg-indigo-500/10",
    icon: "text-indigo-600 dark:text-indigo-400",
    number: "text-indigo-700 dark:text-indigo-300",
    label: "text-indigo-600/70 dark:text-indigo-300/70",
    dot: "bg-indigo-500 dark:bg-indigo-400",
  },
  violet: {
    bg: "bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/80 dark:via-violet-900/30 dark:to-[#080e1c]",
    border: "border-violet-200 dark:border-violet-500/30",
    activeBorder: "border-violet-400 shadow-[0_0_20px_rgba(139,92,246,0.35)]",
    glow: "bg-violet-500/10",
    icon: "text-violet-600 dark:text-violet-400",
    number: "text-violet-700 dark:text-violet-300",
    label: "text-violet-600/70 dark:text-violet-300/70",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  purple: {
    bg: "bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/80 dark:via-purple-900/30 dark:to-[#080e1c]",
    border: "border-purple-200 dark:border-purple-500/30",
    activeBorder: "border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.35)]",
    glow: "bg-purple-500/10",
    icon: "text-purple-600 dark:text-purple-400",
    number: "text-purple-700 dark:text-purple-300",
    label: "text-purple-600/70 dark:text-purple-300/70",
    dot: "bg-purple-500 dark:bg-purple-400",
  },
};

// ─── Anulaciones badge helpers ───────────────────────────────────────────────
function AnulOpBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    recibida: { label: "Recibida", cls: "bg-blue-500/15 text-blue-300 border-blue-500/20" },
    en_revision: { label: "En revisión", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
    pendiente_documentacion: { label: "Pend. docs", cls: "bg-orange-500/15 text-orange-300 border-orange-500/20" },
    pendiente_decision: { label: "Pend. decisión", cls: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20" },
    resuelta: { label: "Resuelta", cls: "bg-green-500/15 text-green-300 border-green-500/20" },
    cerrada: { label: "Cerrada", cls: "bg-gray-500/15 text-gray-400 border-gray-500/20" },
    incidencia: { label: "Incidencia", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}
function AnulResBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sin_resolver: { label: "Sin resolver", cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" },
    rechazada: { label: "Rechazada", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
    aceptada_total: { label: "Aceptada total", cls: "bg-green-500/15 text-green-300 border-green-500/20" },
    aceptada_parcial: { label: "Aceptada parcial", cls: "bg-teal-500/15 text-teal-300 border-teal-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}
function AnulFinBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sin_compensacion: { label: "Sin comp.", cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" },
    pendiente_devolucion: { label: "Pend. dev.", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
    devuelta_economicamente: { label: "Devuelta", cls: "bg-green-500/15 text-green-300 border-green-500/20" },
    pendiente_bono: { label: "Pend. bono", cls: "bg-purple-500/15 text-purple-300 border-purple-500/20" },
    compensada_bono: { label: "Bono enviado", cls: "bg-violet-500/15 text-violet-300 border-violet-500/20" },
    incidencia_economica: { label: "Incid. ec.", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-foreground/[0.05] text-foreground/50 border-foreground/[0.12]" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

function fmtAmount(n: number): string {
  if (n === 0) return "";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function CounterCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
  color = "blue",
  subtitle,
  amount,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  active?: boolean;
  onClick?: () => void;
  color?: keyof typeof COUNTER_STYLES;
  subtitle?: string;
  amount?: number;
}) {
  const s = COUNTER_STYLES[color] ?? COUNTER_STYLES.blue;
  const numericValue = typeof value === "number" ? value : null;
  const displayValue = typeof value === "string" ? value : undefined;
  const animated = useCountUp(numericValue ?? 0);

  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col justify-between p-3.5 rounded-xl border transition-all duration-300 text-left w-full overflow-hidden
        ${s.bg} ${active ? s.activeBorder : s.border}
        ${onClick ? "cursor-pointer hover:scale-[1.02] hover:brightness-110" : "cursor-default"}
        ${active ? "scale-[1.02]" : ""}
      `}
    >
      {/* Glow blob */}
      <div className={`absolute -top-3 -right-3 w-14 h-14 rounded-full blur-xl opacity-50 ${s.glow} transition-opacity duration-300 group-hover:opacity-80`} />

      {/* Top row: label + icon */}
      <div className="flex items-center justify-between mb-2 relative z-10">
        <span className={`text-[10px] font-semibold uppercase tracking-widest ${s.label}`}>{label}</span>
        <div className={`p-1.5 rounded-lg ${s.glow} border ${active ? s.activeBorder : s.border}`}>
          <Icon className={`w-3.5 h-3.5 ${s.icon}`} />
        </div>
      </div>

      {/* Number + Amount */}
      <div className="relative z-10 flex items-end justify-between gap-1">
        <div>
          <span className={`text-2xl font-black tabular-nums tracking-tight ${s.number}`}>
            {numericValue !== null ? animated : displayValue}
          </span>
          {subtitle && <p className={`text-[10px] mt-0.5 ${s.label}`}>{subtitle}</p>}
        </div>
        {amount != null && amount > 0 && (
          <span className={`text-[11px] font-semibold tabular-nums pb-0.5 ${s.number} opacity-70`}>
            {fmtAmount(amount)}
          </span>
        )}
      </div>

      {/* Active indicator bar */}
      {active && (
        <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${s.dot}`} />
      )}
    </button>
  );
}

// ─── LEAD DETAIL MODAL ────────────────────────────────────────────────────────

function LeadDetailModal({
  leadId,
  onClose,
  onConvert,
}: {
  leadId: number;
  onClose: () => void;
  onConvert: (leadId: number, leadName?: string) => void;
}) {
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.crm.leads.get.useQuery({ id: leadId });

  const addNote = trpc.crm.leads.addNote.useMutation({
    onSuccess: () => {
      toast.success("Nota añadida");
      setNote("");
      utils.crm.leads.get.invalidate({ id: leadId });
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success("Estado actualizado");
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
    },
  });

  const markLost = trpc.crm.leads.markLost.useMutation({
    onSuccess: () => {
      toast.success("Lead marcado como perdido");
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.leads.counters.invalidate();
      onClose();
    },
  });

  const generateQuote = trpc.crm.leads.generateFromLead.useMutation({
    onSuccess: (result) => {
      toast.success(
        `✨ Presupuesto ${result.quoteNumber} generado con ${result.itemCount} línea${result.itemCount !== 1 ? "s" : ""} — Total: ${result.total.toFixed(2)}€`,
        { duration: 5000 }
      );
      utils.crm.leads.get.invalidate({ id: leadId });
      utils.crm.quotes.list.invalidate();
      onClose();
      // Navegar al presupuesto generado
      window.location.href = `/admin/crm?tab=quotes&quoteId=${result.quoteId}`;
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { lead, activity, quotes: relatedQuotes } = data;

  return (
    <>
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center font-bold text-sm">
            {lead.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-bold">{lead.name}</div>
            <div className="text-sm text-foreground/60 font-normal">{lead.email}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Status & Priority */}
        <div className="flex items-center gap-3 flex-wrap">
          <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
          {(lead as any).source === "venta_perdida" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/25">
              Venta abandonada
            </span>
          )}
          <PriorityDot priority={lead.priority as Priority} />
          <span className="text-xs text-foreground/50 capitalize">{lead.priority} prioridad</span>
          <span className="text-xs text-foreground/40">·</span>
          <span className="text-xs text-foreground/50">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</span>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-2 gap-3">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-foreground/70 hover:text-orange-400 transition-colors">
              <Phone className="w-3.5 h-3.5" /> {lead.phone}
            </a>
          )}
          <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-foreground/70 hover:text-orange-400 transition-colors">
            <Mail className="w-3.5 h-3.5" /> {lead.email}
          </a>
        </div>

        {/* Request details */}
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-2">
          {lead.selectedCategory && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">Categoría</span>
              <span className="text-white font-medium">{lead.selectedCategory}</span>
            </div>
          )}
          {lead.selectedProduct && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">Producto</span>
              <span className="text-white font-medium">{lead.selectedProduct}</span>
            </div>
          )}
          {lead.preferredDate && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">Fecha de la actividad</span>
              <span className="text-white font-medium">{new Date(lead.preferredDate).toLocaleDateString("es-ES")}</span>
            </div>
          )}
          {(lead.numberOfAdults || lead.numberOfPersons) && (
            <div className="flex justify-between text-sm">
              <span className="text-foreground/60">Personas</span>
              <span className="text-white font-medium">
                {lead.numberOfAdults ? `${lead.numberOfAdults} adultos` : ""}{lead.numberOfChildren ? ` + ${lead.numberOfChildren} niños` : ""}
                {!lead.numberOfAdults && lead.numberOfPersons ? `${lead.numberOfPersons} personas` : ""}
              </span>
            </div>
          )}
          {/* Actividades enriquecidas desde el formulario multi-actividad */}
          {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 && (
            <div className="pt-2 border-t border-foreground/[0.12]">
              <p className="text-xs text-foreground/50 uppercase tracking-wider mb-2">Actividades solicitadas</p>
              <div className="space-y-2">
                {(lead.activitiesJson as any[]).map((act: any, i: number) => (
                  <div key={i} className="bg-white/[0.06] rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold text-white">{act.experienceTitle}</span>
                      <span className="text-xs text-orange-400 font-bold bg-orange-500/10 px-2 py-0.5 rounded-full">{act.participants} pax</span>
                    </div>
                    {act.details && Object.keys(act.details).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(act.details).map(([k, v]) => {
                          const labelMap: Record<string, string> = {
                            duration: 'Duración', jumps: 'Saltos', level: 'Nivel',
                            type: 'Tipo', notes: 'Notas'
                          };
                          return (
                            <span key={k} className="text-xs bg-sky-500/10 text-sky-300 border border-sky-500/20 rounded-full px-2 py-0.5">
                              {labelMap[k] ?? k}: <strong>{String(v)}</strong>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {lead.message && (
            <div className="pt-2 border-t border-foreground/[0.12]">
              <p className="text-sm text-foreground/65 italic">"{lead.message}"</p>
            </div>
          )}
        </div>

        {/* Related quotes */}
        {relatedQuotes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Presupuestos asociados</h4>
            <div className="space-y-2">
              {relatedQuotes.map((q: any) => (
                <div key={q.id} className="flex items-center justify-between bg-foreground/[0.05] rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-foreground">{q.quoteNumber}</span>
                    <span className="text-xs text-foreground/50 ml-2">{q.title}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <QuoteStatusBadge status={q.status as QuoteStatus} />
                    <span className="text-sm font-bold text-orange-400">{Number(q.total).toFixed(2)} €</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Notas internas</h4>
          {Array.isArray(lead.internalNotes) && lead.internalNotes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {(lead.internalNotes as { text: string; authorName: string; createdAt: string }[]).map((n, i) => (
                <div key={i} className="bg-foreground/[0.05] rounded-lg px-3 py-2">
                  <p className="text-sm text-foreground/80">{n.text}</p>
                  <p className="text-xs text-foreground/40 mt-1">{n.authorName} · {new Date(n.createdAt).toLocaleString("es-ES")}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-foreground/40 mb-3">Sin notas aún</p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Añadir nota interna..."
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none h-16"
            />
            <Button
              size="sm"
              onClick={() => addNote.mutate({ id: leadId, text: note })}
              disabled={!note.trim() || addNote.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white self-end"
            >
              <MessageSquare className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Change status */}
        <div>
          <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Cambiar estado</h4>
          <div className="flex gap-2 flex-wrap">
            {(["nueva", "enviada", "ganada", "perdida"] as OpportunityStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className={`border-foreground/[0.15] text-foreground/70 hover:text-foreground text-xs capitalize ${lead.opportunityStatus === s ? "bg-foreground/[0.08] text-white" : ""}`}
                onClick={() => updateStatus.mutate({ id: leadId, opportunityStatus: s })}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          onClick={() => markLost.mutate({ id: leadId })}
        >
          <XCircle className="w-4 h-4 mr-1" /> Marcar perdido
        </Button>
        {/* Botón 'Generar presupuesto' eliminado — flujo correcto es 'Crear Presupuesto' que abre el modal */}
        <Button
          size="sm"
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
          onClick={() => { onClose(); onConvert(leadId, undefined); }}
        >
          <FileText className="w-4 h-4 mr-1" /> Crear Presupuesto
        </Button>
      </DialogFooter>
    </DialogContent>
    </>
  );
}

// ─── LEAD EDIT MODAL ────────────────────────────────────────────────────────

function LeadEditModal({
  leadId,
  onClose,
}: {
  leadId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.crm.leads.get.useQuery({ id: leadId });

  type ActivityLine = {
    id: string;
    experienceId: number | null;
    experienceTitle: string;
    family: string;
    participants: number;
    search: string;
    showSuggestions: boolean;
  };

  const [form, setForm] = React.useState<{
    name: string; email: string; phone: string; company: string;
    selectedCategory: string; selectedProduct: string;
    message: string; priority: string; opportunityStatus: string;
    preferredDate: string; numberOfAdults: number; numberOfChildren: number;
  } | null>(null);
  const [activityLines, setActivityLines] = React.useState<ActivityLine[]>([]);
  const [activeLineIdx, setActiveLineIdx] = React.useState<number>(0);
  const [initialized, setInitialized] = React.useState(false);

  // Populate form once data loads
  React.useEffect(() => {
    if (data && !initialized) {
      const { lead } = data;
      setForm({
        name: lead.name ?? "",
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        company: (lead as any).company ?? "",
        selectedCategory: lead.selectedCategory ?? "",
        selectedProduct: lead.selectedProduct ?? "",
        message: lead.message ?? "",
        priority: lead.priority ?? "media",
        opportunityStatus: lead.opportunityStatus ?? "nueva",
        preferredDate: lead.preferredDate ? new Date(lead.preferredDate).toISOString().split("T")[0] : "",
        numberOfAdults: (lead as any).numberOfAdults ?? 2,
        numberOfChildren: (lead as any).numberOfChildren ?? 0,
      });
      const existingActivities = (lead as any).activitiesJson as ActivityLine[] | null;
      if (existingActivities && existingActivities.length > 0) {
        setActivityLines(existingActivities.map((a: any, i: number) => ({
          id: String(i + 1),
          experienceId: a.experienceId ?? null,
          experienceTitle: a.experienceTitle ?? "",
          family: a.family ?? "general",
          participants: a.participants ?? 2,
          search: "",
          showSuggestions: false,
        })));
      } else {
        setActivityLines([{ id: "1", experienceId: null, experienceTitle: "", family: "", participants: 2, search: "", showSuggestions: false }]);
      }
      setInitialized(true);
    }
  }, [data, initialized]);

  const activeSearch = activityLines[activeLineIdx]?.search ?? "";
  const { data: productSuggestions } = trpc.crm.products.search.useQuery(
    { q: activeSearch, limit: 8 },
    { enabled: activeSearch.length >= 2 }
  );

  const updateLine = (idx: number, patch: Partial<ActivityLine>) => {
    setActivityLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => {
    setActivityLines(prev => [...prev, { id: String(Date.now()), experienceId: null, experienceTitle: "", family: "", participants: 2, search: "", showSuggestions: false }]);
    setActiveLineIdx(activityLines.length);
  };
  const removeLine = (idx: number) => {
    if (activityLines.length === 1) return;
    setActivityLines(prev => prev.filter((_, i) => i !== idx));
    setActiveLineIdx(Math.max(0, activeLineIdx - 1));
  };

  const updateLead = trpc.crm.leads.update.useMutation({
    onSuccess: () => {
      toast.success("Lead actualizado");
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) {
    return (
      <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  const handleSave = () => {
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Nombre y email son obligatorios");
      return;
    }
    const validActivities = activityLines.filter(l => l.experienceTitle.trim());
    updateLead.mutate({
      id: leadId,
      name: form.name,
      email: form.email,
      phone: form.phone,
      company: form.company || undefined,
      selectedCategory: form.selectedCategory || undefined,
      selectedProduct: validActivities.length > 0 ? validActivities[0].experienceTitle : form.selectedProduct,
      message: form.message,
      priority: form.priority as "baja" | "media" | "alta",
      opportunityStatus: form.opportunityStatus as "nueva" | "enviada" | "ganada" | "perdida",
      preferredDate: form.preferredDate || undefined,
      numberOfAdults: form.numberOfAdults,
      numberOfChildren: form.numberOfChildren,
      activitiesJson: validActivities.length > 0
        ? validActivities.map(l => ({
            experienceId: l.experienceId ?? 0,
            experienceTitle: l.experienceTitle,
            family: l.family || "general",
            participants: l.participants,
            details: {},
          }))
        : undefined,
    });
  };

  return (
    <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Pencil className="w-4 h-4 text-orange-400" /> Editar Lead
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-foreground/65 text-xs">Nombre <span className="text-red-400">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Email <span className="text-red-400">*</span></Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Teléfono</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Empresa / Grupo</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
        </div>

        {/* Líneas de actividad */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">Actividades de interés</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors">
              <Plus className="w-3 h-3" /> Añadir actividad
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-4">{idx + 1}.</span>
                  <div className="relative flex-1">
                    <Input
                      value={line.experienceTitle || line.search}
                      onChange={e => { updateLine(idx, { search: e.target.value, experienceTitle: "", experienceId: null }); setActiveLineIdx(idx); }}
                      onFocus={() => { updateLine(idx, { showSuggestions: true }); setActiveLineIdx(idx); }}
                      onBlur={() => setTimeout(() => updateLine(idx, { showSuggestions: false }), 200)}
                      placeholder="Buscar experiencia o pack..."
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25 text-sm h-8"
                    />
                    {line.showSuggestions && productSuggestions && productSuggestions.length > 0 && activeLineIdx === idx && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.15] rounded-lg shadow-xl max-h-40 overflow-y-auto">
                        {(productSuggestions as any[]).map((p: any) => (
                          <button key={`${p.productType}-${p.id}`} type="button"
                            className="w-full text-left px-3 py-2 hover:bg-foreground/[0.07] text-xs text-white flex items-center gap-2"
                            onMouseDown={() => updateLine(idx, {
                              experienceId: p.id,
                              experienceTitle: p.title,
                              family: p.productType === "experience" ? "experience" : "pack",
                              search: "",
                              showSuggestions: false,
                            })}>
                            <span className="text-foreground/50">{p.productType === "experience" ? "🏊" : "📦"}</span>
                            <span>{p.title}</span>
                            {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-foreground/50">{Number(p.basePrice).toFixed(2)}€</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-foreground/50">Pax</span>
                    <Input
                      type="number" min={1} value={line.participants}
                      onChange={e => updateLine(idx, { participants: Math.max(1, Number(e.target.value)) })}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-14 h-8 text-xs text-center"
                    />
                    {activityLines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-foreground/40 hover:text-red-400 transition-colors ml-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {line.experienceTitle && (
                  <p className="text-xs text-emerald-400 pl-6">✓ {line.experienceTitle}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Fecha y participantes */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-foreground/65 text-xs">Fecha de la actividad</Label>
            <Input type="date" value={form.preferredDate} onChange={e => setForm({ ...form, preferredDate: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Adultos</Label>
            <Input type="number" min={1} value={form.numberOfAdults} onChange={e => setForm({ ...form, numberOfAdults: Number(e.target.value) })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Niños</Label>
            <Input type="number" min={0} value={form.numberOfChildren} onChange={e => setForm({ ...form, numberOfChildren: Number(e.target.value) })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
        </div>

        {/* Prioridad y estado */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-foreground/65 text-xs">Prioridad</Label>
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="baja" className="text-white">Baja</SelectItem>
                <SelectItem value="media" className="text-white">Media</SelectItem>
                <SelectItem value="alta" className="text-white">Alta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Estado oportunidad</Label>
            <Select value={form.opportunityStatus} onValueChange={(v) => setForm({ ...form, opportunityStatus: v })}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="nueva" className="text-white">1. Nueva Oportunidad</SelectItem>
                <SelectItem value="enviada" className="text-white">2. Oportunidad Enviada</SelectItem>
                <SelectItem value="ganada" className="text-white">3. Oportunidad Ganada</SelectItem>
                <SelectItem value="perdida" className="text-white">4. Oportunidad Perdida</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Notas */}
        <div>
          <Label className="text-foreground/65 text-xs">Mensaje / Comentarios</Label>
          <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-16 text-sm" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={updateLead.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
        >
          {updateLead.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
          Guardar cambios
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── PRODUCT SEARCH COMBOBOX ─────────────────────────────────────────────────

function ProductSearchInput({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (product: CatalogProduct) => void;
}) {
  return (
    <CatalogConceptSelector
      value={value}
      onChange={onChange}
      onSelectProduct={onSelect}
      inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm"
      showBadge={false}
    />
  );
}

// ─── DIRECT QUOTE MODAL (sin lead previo) ───────────────────────────────────

// ─── NEW LEAD MODAL (creación manual de lead por admin) ──────────────────────

function NewLeadModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [messageText, setMessageText] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [source, setSource] = useState("admin");

  // ── Líneas de actividad ──────────────────────────────────────────────────
  type ActivityLine = {
    id: string;
    experienceId: number | null;
    experienceTitle: string;
    family: string;
    participants: number;
  };
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([
    { id: "1", experienceId: null, experienceTitle: "", family: "", participants: 2 },
  ]);

  const updateLine = (idx: number, patch: Partial<ActivityLine>) => {
    setActivityLines(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };
  const addLine = () => {
    setActivityLines(prev => [...prev, {
      id: String(Date.now()),
      experienceId: null,
      experienceTitle: "",
      family: "",
      participants: 2,
    }]);
  };
  const removeLine = (idx: number) => {
    if (activityLines.length === 1) return;
    setActivityLines(prev => prev.filter((_, i) => i !== idx));
  };

  const createLead = trpc.crm.leads.create.useMutation({
    onSuccess: () => {
      toast.success(`Lead de ${name} creado correctamente`);
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Nombre y email son obligatorios");
      return;
    }
    const validActivities = activityLines.filter(l => l.experienceTitle.trim());
    createLead.mutate({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      company: company.trim() || undefined,
      message: messageText.trim() || undefined,
      preferredDate: preferredDate || undefined,
      numberOfAdults: adults,
      numberOfChildren: children,
      selectedProduct: validActivities.length > 0 ? validActivities[0].experienceTitle : undefined,
      source,
      activitiesJson: validActivities.length > 0
        ? validActivities.map(l => ({
            experienceId: l.experienceId ?? 0,
            experienceTitle: l.experienceTitle,
            family: l.family || "general",
            participants: l.participants,
            details: {},
          }))
        : undefined,
    });
  };

  return (
    <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-400" /> Nuevo Lead
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Nombre <span className="text-red-400">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ana García" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Email <span className="text-red-400">*</span></Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ana@ejemplo.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Teléfono</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Empresa / Grupo</Label>
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Empresa S.L." className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
          </div>
        </div>

        {/* Líneas de actividad */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-foreground/60">Actividades de interés</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
              <Plus className="w-3 h-3" /> Añadir actividad
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-4 shrink-0">{idx + 1}.</span>
                  <CatalogConceptSelector
                    className="flex-1 min-w-0"
                    value={line.experienceTitle}
                    onChange={(v) => updateLine(idx, { experienceTitle: v, experienceId: null, family: "" })}
                    onSelectProduct={(p) => updateLine(idx, {
                      experienceId: p.id,
                      experienceTitle: p.title,
                      family: p.productType === "experience" ? "experience" : "pack",
                    })}
                    inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25 text-sm h-8"
                    placeholder="Buscar experiencia o pack..."
                    showBadge={false}
                    sourceType={line.family === "experience" ? "experience" : line.family === "pack" ? "legoPack" : undefined}
                  />
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-foreground/50">Pax</span>
                    <Input
                      type="number" min={1} value={line.participants}
                      onChange={e => updateLine(idx, { participants: Math.max(1, Number(e.target.value)) })}
                      className="bg-foreground/[0.05] border-foreground/[0.12] text-white w-14 h-8 text-xs text-center"
                    />
                    {activityLines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-foreground/40 hover:text-red-400 transition-colors ml-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {line.experienceId && (
                  <p className="text-xs text-emerald-400 pl-6 mt-1.5 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                    {line.family === "experience" ? "Experiencia" : "Pack"} vinculado del catálogo
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Fecha y participantes globales */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-xs text-foreground/60 mb-1 block">Fecha de la actividad</Label>
            <Input type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Adultos</Label>
            <Input type="number" min={1} value={adults} onChange={e => setAdults(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
          <div>
            <Label className="text-xs text-foreground/60 mb-1 block">Niños</Label>
            <Input type="number" min={0} value={children} onChange={e => setChildren(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
          </div>
        </div>

        {/* Canal y notas */}
        <div>
          <Label className="text-xs text-foreground/60 mb-1 block">Canal de origen</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
              <SelectItem value="admin" className="text-white text-xs">💼 Admin (manual)</SelectItem>
              <SelectItem value="telefono" className="text-white text-xs">📞 Teléfono</SelectItem>
              <SelectItem value="email" className="text-white text-xs">📧 Email</SelectItem>
              <SelectItem value="whatsapp" className="text-white text-xs">💬 WhatsApp</SelectItem>
              <SelectItem value="presencial" className="text-white text-xs">👤 Presencial</SelectItem>
              <SelectItem value="otro" className="text-white text-xs">❓ Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-foreground/60 mb-1 block">Mensaje / notas</Label>
          <Textarea value={messageText} onChange={e => setMessageText(e.target.value)} placeholder="Información adicional del cliente..." rows={3} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25 resize-none" />
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
        <Button size="sm" onClick={handleSubmit} disabled={createLead.isPending} className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white">
          {createLead.isPending ? "Creando..." : "Crear Lead"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── NEW RESERVATION MODAL (creación manual de reserva por admin) ─────────────

function NewReservationModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showClientSugg, setShowClientSugg] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productId, setProductId] = useState<number | null>(null);
  const [productName, setProductName] = useState("");
  const [showProductSugg, setShowProductSugg] = useState(false);

  const [bookingDate, setBookingDate] = useState("");
  const [people, setPeople] = useState(2);

  const [amountTotal, setAmountTotal] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"efectivo" | "transferencia" | "redsys" | "otro">("efectivo");
  const [channel, setChannel] = useState<"crm" | "telefono" | "email" | "otro">("crm");
  const [notes, setNotes] = useState("");
  const [sendEmailConfirm, setSendEmailConfirm] = useState(true);

  const { data: clientSuggestionsRaw } = trpc.crm.clients.list.useQuery(
    { search: clientSearch, limit: 6 },
    { enabled: clientSearch.length >= 2 }
  );
  const clientSuggestions = clientSuggestionsRaw?.items ?? [];

  const { data: productSuggestions } = trpc.crm.products.search.useQuery(
    { q: productSearch, limit: 8 },
    { enabled: productSearch.length >= 2 }
  );

  const createManual = trpc.crm.reservations.createManual.useMutation({
    onSuccess: (data) => {
      toast.success(`Reserva ${data.merchantOrder} creada — Factura ${data.invoiceNumber}`);
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    if (!customerName.trim() || !customerEmail.trim()) { toast.error("Nombre y email del cliente son obligatorios"); return; }
    if (!productId || !productName) { toast.error("Selecciona un producto"); return; }
    if (!bookingDate) { toast.error("La fecha del servicio es obligatoria"); return; }
    const total = parseFloat(amountTotal);
    const paid = parseFloat(amountPaid || amountTotal);
    if (isNaN(total) || total < 0) { toast.error("El importe total debe ser un número válido"); return; }
    createManual.mutate({
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim() || undefined,
      productId,
      productName,
      bookingDate,
      people,
      amountTotal: total,
      amountPaid: isNaN(paid) ? total : paid,
      paymentMethod,
      notes: notes.trim() || undefined,
      channel,
      sendConfirmationEmail: sendEmailConfirm,
    });
  };

  return (
    <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-emerald-400" /> Nueva Reserva
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {/* Cliente */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Cliente</p>
          <div className="relative">
            <Label className="text-xs text-foreground/60 mb-1 block">Nombre completo *</Label>
            <Input
              value={customerName || clientSearch}
              onChange={e => { setClientSearch(e.target.value); setCustomerName(""); setShowClientSugg(true); }}
              onFocus={() => setShowClientSugg(true)}
              placeholder="Buscar cliente existente o escribir nuevo..."
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25"
            />
            {showClientSugg && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.15] rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {clientSuggestions.map((c) => (
                  <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-foreground/[0.07] text-sm text-white"
                    onClick={() => { setCustomerName(c.name); setCustomerEmail(c.email ?? ""); setCustomerPhone(c.phone ?? ""); setClientSearch(""); setShowClientSugg(false); }}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-foreground/50 ml-2 text-xs">{c.email}</span>
                  </button>
                ))}
              </div>
            )}
            {customerName && <p className="text-xs text-emerald-400 mt-1">✓ {customerName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Email *</Label>
              <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="cliente@email.com" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
            </div>
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Teléfono</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
            </div>
          </div>
        </div>
        {/* Producto */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Producto / Servicio</p>
          <div className="relative">
            <Label className="text-xs text-foreground/60 mb-1 block">Experiencia o pack *</Label>
            <Input
              value={productName || productSearch}
              onChange={e => { setProductSearch(e.target.value); setProductId(null); setProductName(""); setShowProductSugg(true); }}
              onFocus={() => setShowProductSugg(true)}
              placeholder="Buscar producto..."
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25"
            />
            {showProductSugg && productSuggestions && (productSuggestions as any[]).length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.15] rounded-lg shadow-xl max-h-48 overflow-y-auto">
                {(productSuggestions as any[]).map((p: any) => (
                  <button key={`${p.productType}-${p.id}`} type="button" className="w-full text-left px-3 py-2 hover:bg-foreground/[0.07] text-sm text-white flex items-center gap-2"
                    onClick={() => {
                      setProductId(p.id); setProductName(p.title);
                      if (p.basePrice && Number(p.basePrice) > 0) { const base = Number(p.basePrice) * people; setAmountTotal(base.toFixed(2)); setAmountPaid(base.toFixed(2)); }
                      setProductSearch(""); setShowProductSugg(false);
                    }}>
                    <span className="text-foreground/50 text-xs">{p.productType === "experience" ? "🏊" : "📦"}</span>
                    <span>{p.title}</span>
                    {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-foreground/50 text-xs">{Number(p.basePrice).toFixed(2)}€/pers</span>}
                  </button>
                ))}
              </div>
            )}
            {productName && <p className="text-xs text-emerald-400 mt-1">✓ {productName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Fecha del servicio *</Label>
              <Input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
            </div>
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Nº personas</Label>
              <Input type="number" min={1} value={people} onChange={e => setPeople(Number(e.target.value))} className="bg-foreground/[0.05] border-foreground/[0.12] text-white" />
            </div>
          </div>
        </div>
        {/* Económico */}
        <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-foreground/60 uppercase tracking-wider">Datos económicos</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Importe total (€) *</Label>
              <Input type="number" min={0} step="0.01" value={amountTotal} onChange={e => setAmountTotal(e.target.value)} placeholder="0.00" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
            </div>
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Importe cobrado (€)</Label>
              <Input type="number" min={0} step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder="Igual al total si pagado" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Método de pago</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="efectivo" className="text-white text-xs">💵 Efectivo</SelectItem>
                  <SelectItem value="transferencia" className="text-white text-xs">🏦 Transferencia</SelectItem>
                  <SelectItem value="tarjeta_fisica" className="text-white text-xs">💳 Tarjeta Física</SelectItem>
                  <SelectItem value="tarjeta_redsys" className="text-white text-xs">💳 Tarjeta Redsys</SelectItem>
                  <SelectItem value="redsys" className="text-white text-xs">💳 Tarjeta Redsys (legacy)</SelectItem>
                  <SelectItem value="otro" className="text-white text-xs">❓ Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-foreground/60 mb-1 block">Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="crm" className="text-white text-xs">💼 CRM (admin)</SelectItem>
                  <SelectItem value="telefono" className="text-white text-xs">📞 Teléfono</SelectItem>
                  <SelectItem value="email" className="text-white text-xs">📧 Email</SelectItem>
                  <SelectItem value="otro" className="text-white text-xs">❓ Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <div>
          <Label className="text-xs text-foreground/60 mb-1 block">Notas internas</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas para el equipo..." rows={2} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-white/25 resize-none" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={sendEmailConfirm} onChange={e => setSendEmailConfirm(e.target.checked)} className="rounded" />
          <span className="text-sm text-foreground/65">Enviar email de confirmación al cliente</span>
        </label>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
        <Button size="sm" onClick={handleSubmit} disabled={createManual.isPending} className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white">
          {createManual.isPending ? "Creando reserva..." : "Crear Reserva"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DirectQuoteModal({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();

  // Paso 1: datos del cliente
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientCompany, setClientCompany] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [showClientSuggestions, setShowClientSuggestions] = useState(false);

  // Paso 2: líneas de presupuesto
  const [title, setTitle] = useState("Presupuesto Nayade Experiences");
  const [conditions, setConditions] = useState("Presupuesto válido por 15 días. Sujeto a disponibilidad.");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
  // Plan de pago fraccionado (draft local)
  const [showPlanSectionD, setShowPlanSectionD] = useState(false);
  type DraftInstD = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallmentsD, setDraftInstallmentsD] = useState<DraftInstD[]>([]);
  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [promoData, setPromoData] = useState<{ id: number; code: string; discountPercent: number } | null>(null);
  const validatePromo = trpc.discounts.validate.useMutation({
    onSuccess: (d) => setPromoData({ id: d.id, code: d.code, discountPercent: d.discountPercent }),
    onError: (e) => { toast.error(e.message); setPromoData(null); },
  });

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotal = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const promoDiscount = promoData ? parseFloat((subtotal * promoData.discountPercent / 100).toFixed(2)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - promoDiscount);
  const discountedGeneral = Math.max(0, generalSubtotal - (promoData ? parseFloat((generalSubtotal * promoData.discountPercent / 100).toFixed(2)) : 0));
  // Multi-rate breakdown
  const taxRowsD = (() => {
    const promoRatio = generalSubtotal > 0 ? discountedGeneral / generalSubtotal : 1;
    const groups: Record<number, number> = {};
    items.filter(i => i.fiscalRegime !== "reav").forEach(item => {
      const rate = (item as any).taxRate ?? 21;
      groups[rate] = (groups[rate] ?? 0) + item.total * promoRatio;
    });
    return Object.entries(groups).map(([rateStr, gross]) => {
      const rate = Number(rateStr);
      const div = 1 + rate / 100;
      return { rate, amount: parseFloat((gross - gross / div).toFixed(2)) };
    }).sort((a, b) => b.rate - a.rate);
  })();
  const taxAmount = parseFloat(taxRowsD.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateD = taxRowsD.length === 1 ? taxRowsD[0].rate : taxRate;
  const total = parseFloat((discountedSubtotal + taxAmount).toFixed(2));

  // Búsqueda de clientes existentes
  const { data: clientSuggestionsRaw } = trpc.crm.clients.list.useQuery(
    { search: clientSearch, limit: 6 },
    { enabled: clientSearch.length >= 2 }
  );
  const clientSuggestions = clientSuggestionsRaw?.items ?? [];

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.total = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      })
    );
  };

  const upsertPlanDirect = trpc.crm.paymentPlans.upsert.useMutation({
    onError: (e) => toast.error(`Plan de pago: ${e.message}`),
  });

  const createDirect = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: async (data) => {
      if (draftInstallmentsD.length > 0) {
        await upsertPlanDirect.mutateAsync({
          quoteId: data.quoteId,
          installments: draftInstallmentsD.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
        });
        toast.success(`Presupuesto ${data.quoteNumber} creado con plan de ${draftInstallmentsD.length} cuotas`);
      } else {
        toast.success(
          data.sent
            ? `Presupuesto ${data.quoteNumber} creado y enviado al cliente`
            : `Presupuesto ${data.quoteNumber} guardado como borrador`
        );
      }
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (andSend: boolean) => {
    if (!clientName || !clientEmail) {
      toast.error("Nombre y email del cliente son obligatorios");
      return;
    }
    if (items.some((i) => !i.description)) {
      toast.error("Completa la descripción de todos los conceptos");
      return;
    }
    if (draftInstallmentsD.some(i => !i.dueDate || i.amountCents <= 0)) {
      toast.error("Completa el importe y la fecha de todas las cuotas del plan");
      return;
    }
    setSendAfterCreate(andSend);
    createDirect.mutate({
      clientName,
      clientEmail,
      clientPhone: clientPhone || undefined,
      clientCompany: clientCompany || undefined,
      title,
      items: items.map(i => ({ ...i, taxRate: (i as any).taxRate ?? 21 })),
      subtotal,
      discount: promoDiscount,
      taxRate: effectiveTaxRateD,
      total,
      validUntil,
      notes: promoData ? `Código ${promoData.code} (-${promoData.discountPercent}%)${notes ? "\n" + notes : ""}` : notes || undefined,
      conditions,
      sendNow: andSend,
      origin: window.location.origin,
    });
  };

  const selectClient = (c: { name: string; email: string; phone?: string | null; company?: string | null }) => {
    setClientName(c.name);
    setClientEmail(c.email);
    setClientPhone(c.phone ?? "");
    setClientCompany(c.company ?? "");
    setClientSearch("");
    setShowClientSuggestions(false);
    setTitle(`Presupuesto Nayade Experiences - ${c.name}`);
  };

  return (
    <>
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Plus className="w-5 h-5 text-orange-400" /> Nuevo Presupuesto
          <span className="text-foreground/50 text-sm font-normal ml-1">sin lead previo</span>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* ── Sección cliente ── */}
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-foreground/60">Datos del cliente</span>
          </div>

          {/* Buscador de cliente existente */}
          <div className="relative">
            <Label className="text-foreground/65 text-xs">Buscar cliente existente</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
              <Input
                className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm"
                placeholder="Nombre o email del cliente..."
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setShowClientSuggestions(true); }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
              />
            </div>
            {showClientSuggestions && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.12] rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {clientSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-foreground/[0.08] flex items-center justify-between gap-2"
                    onMouseDown={() => selectClient(c)}
                  >
                    <div>
                      <div className="text-sm text-white font-medium">{c.name}</div>
                      <div className="text-xs text-foreground/50">{c.email}</div>
                    </div>
                    {c.company && <span className="text-xs text-foreground/40 shrink-0">{c.company}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-foreground/40 text-center">— o introduce los datos manualmente —</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-foreground/65 text-xs">Nombre *</Label>
              <Input value={clientName} onChange={(e) => { setClientName(e.target.value); setTitle(`Presupuesto Nayade Experiences - ${e.target.value}`); }}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 text-sm" placeholder="Nombre completo" />
            </div>
            <div>
              <Label className="text-foreground/65 text-xs">Email *</Label>
              <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 text-sm" placeholder="cliente@email.com" />
            </div>
            <div>
              <Label className="text-foreground/65 text-xs">Teléfono</Label>
              <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 text-sm" placeholder="+34 600 000 000" />
            </div>
            <div>
              <Label className="text-foreground/65 text-xs">Empresa</Label>
              <Input value={clientCompany} onChange={(e) => setClientCompany(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 text-sm" placeholder="Nombre empresa (opcional)" />
            </div>
          </div>
        </div>

        {/* ── Asunto y fechas ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-foreground/65 text-xs">Asunto del presupuesto *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Válido hasta</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="0" className="text-white">0% (exento)</SelectItem>
                <SelectItem value="10" className="text-white">10%</SelectItem>
                <SelectItem value="21" className="text-white">21%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ── Conceptos ── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">Conceptos * <span className="text-foreground/40">(escribe o busca un producto)</span></Label>
            <Button size="sm" variant="ghost" className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}>
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[460px]">
          <div className="text-xs text-foreground/40 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-4">Descripción</span>
            <span className="col-span-2 text-center">Régimen</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <ProductSearchInput
                    value={item.description}
                    onChange={(v) => updateItem(idx, "description", v)}
                    onSelect={(p) => {
                      setItems((prev) => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const unitPrice = Number(p.basePrice);
                        const fr = p.fiscalRegime === "reav" ? "reav" : "general";
                        const tr = Number(p.taxRate ?? 21);
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity, fiscalRegime: fr, taxRate: tr };
                      }));
                    }}
                  />
                </div>
                <select
                  className="col-span-2 bg-foreground/[0.05] border border-foreground/[0.12] text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime === "reav" ? "reav" : (item as any).taxRate === 10 ? "general_10" : "general"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: (e.target.value === "reav" ? "reav" : "general"), taxRate: (e.target.value === "general_10" ? 10 : e.target.value === "reav" ? 0 : 21) } : it))}
                >
                  <option value="general" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="general_10" className="bg-[#0d1526]">IVA 10%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-amber-400" : "text-orange-400"}`}>{item.total.toFixed(2)} €</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-foreground/40 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>

        {/* Totales */}
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal rég. general</span><span>{generalSubtotal.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotal).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {taxRowsD.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>IVA ({row.rate}%)</span><span>{row.amount.toFixed(2)} €</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-foreground/[0.12] pt-2 mt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        <div>
          <Label className="text-foreground/65 text-xs">Notas para el cliente</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Información adicional visible para el cliente..."
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">Condiciones</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-12 text-sm" />
        </div>
      </div>

      {/* ─── PLAN DE PAGO FRACCIONADO (opcional) ─── */}
      <div className="border border-foreground/[0.10] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPlanSectionD(!showPlanSectionD)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-foreground/[0.04] transition-colors"
        >
          <span className="flex items-center gap-2 text-violet-300 font-medium">
            <CreditCard className="w-4 h-4" />
            Plan de pago fraccionado
            {draftInstallmentsD.length > 0 && (
              <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 text-xs px-1.5 py-0.5 rounded-full">
                {draftInstallmentsD.length} cuota{draftInstallmentsD.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
          <span className="text-foreground/40 text-xs">{showPlanSectionD ? "▲ ocultar" : "▼ opcional"}</span>
        </button>
        {showPlanSectionD && (
          <div className="px-4 pb-4 space-y-3 border-t border-foreground/[0.08]">
            <p className="text-xs text-foreground/45 pt-3">Define las cuotas ahora. Se guardarán automáticamente al crear el presupuesto.</p>
            {draftInstallmentsD.map((inst, idx) => (
              <div key={idx} className="space-y-1.5 py-1.5 border-b border-foreground/[0.07] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-5 shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Importe (€)"
                    value={inst._amountStr ?? (inst.amountCents > 0 ? (inst.amountCents / 100).toFixed(2) : "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cents = Math.round(parseFloat(val.replace(",", ".") || "0") * 100) || 0;
                      const updated = [...draftInstallmentsD];
                      updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                      if (idx + 1 < updated.length) {
                        const totalCents = Math.round(total * 100);
                        const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                        const remaining = Math.max(0, totalCents - sumOthers);
                        updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                      }
                      setDraftInstallmentsD(updated);
                    }}
                    className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white placeholder:text-foreground/40 focus:outline-none focus:border-violet-500/50"
                  />
                  <input
                    type="date"
                    value={inst.dueDate}
                    onChange={(e) => {
                      const updated = [...draftInstallmentsD];
                      updated[idx] = { ...updated[idx], dueDate: e.target.value };
                      setDraftInstallmentsD(updated);
                    }}
                    className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                <div className="flex items-center justify-between pl-7">
                  <label className="flex items-center gap-1.5 text-xs text-violet-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inst.isRequiredForConfirmation}
                      onChange={(e) => {
                        const updated = [...draftInstallmentsD];
                        updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                        setDraftInstallmentsD(updated);
                      }}
                      className="accent-violet-500 shrink-0"
                    />
                    Cuota inaplazable
                  </label>
                  <button onClick={() => setDraftInstallmentsD(draftInstallmentsD.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 text-xs">✕ Eliminar</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const totalCents = Math.round(total * 100);
                const sumExisting = draftInstallmentsD.reduce((s, i) => s + i.amountCents, 0);
                const remaining = Math.max(0, totalCents - sumExisting);
                setDraftInstallmentsD([...draftInstallmentsD, {
                  installmentNumber: draftInstallmentsD.length + 1,
                  amountCents: remaining,
                  _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                  dueDate: "",
                  isRequiredForConfirmation: draftInstallmentsD.length === 0,
                  notes: "",
                }]);
              }}
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
            >+ Añadir cuota</button>
            {draftInstallmentsD.length > 0 && (() => {
              const sum = draftInstallmentsD.reduce((s, i) => s + i.amountCents, 0);
              const totalCents = Math.round(total * 100);
              const diff = Math.abs(sum - totalCents);
              return (
                <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                  <span>Suma: {(sum / 100).toFixed(2)} €</span>
                  <span>Total: {total.toFixed(2)} €</span>
                  {diff > 1 && <span>⚠ Dif: {(diff / 100).toFixed(2)} €</span>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
        <Button size="sm" onClick={() => handleSubmit(false)} disabled={createDirect.isPending}
          className="bg-foreground/[0.08] hover:bg-foreground/[0.15] text-white border border-foreground/[0.15]">
          {createDirect.isPending && !sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
          Guardar borrador
        </Button>
        <Button size="sm" onClick={() => handleSubmit(true)} disabled={createDirect.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white">
          {createDirect.isPending && sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
          Crear y Enviar al cliente
        </Button>
      </DialogFooter>
    </DialogContent>
    </>
  );
}

// ─── QUOTE BUILDER MODAL ─────────────────────────────────────────────────────

function QuoteBuilderModal({
  leadId,
  leadName,
  onClose,
}: {
  leadId: number;
  leadName: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(`Presupuesto Nayade Experiences - ${leadName}`);
  const [description, setDescription] = useState("");
  const [conditions, setConditions] = useState("Presupuesto válido por 15 días. Sujeto a disponibilidad.");
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]>([
    { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" },
  ]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
  // Plan de pago fraccionado (draft local — se guarda tras recibir quoteId)
  const [showPlanSection, setShowPlanSection] = useState(false);
  type DraftInst = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallments, setDraftInstallments] = useState<DraftInst[]>([]);
  // Promo code
  const [promoInput, setPromoInput] = useState("");
  const [promoData, setPromoData] = useState<{ id: number; code: string; discountPercent: number } | null>(null);
  const validatePromo = trpc.discounts.validate.useMutation({
    onSuccess: (d) => setPromoData({ id: d.id, code: d.code, discountPercent: d.discountPercent }),
    onError: (e) => { toast.error(e.message); setPromoData(null); },
  });
  const previewQuery = trpc.crm.leads.previewFromLead.useQuery(
    { leadId },
    { enabled: false }
  );
  const handleAutoFill = async () => {
    const result = await previewQuery.refetch();
    if (result.data?.hasActivities && result.data.items.length > 0) {
      setItems(result.data.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]);
      setAutoFilled(true);
      toast.success(`Lineas generadas automaticamente (${result.data.items.length})`);
    } else {
      toast.error("Este lead no tiene actividades seleccionadas");
    }
  };

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotalBuilder = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const promoDiscount = promoData ? parseFloat((subtotal * promoData.discountPercent / 100).toFixed(2)) : 0;
  const discountedSubtotal = Math.max(0, subtotal - promoDiscount);
  const discountedGeneral = Math.max(0, generalSubtotalBuilder - (promoData ? parseFloat((generalSubtotalBuilder * promoData.discountPercent / 100).toFixed(2)) : 0));
  const taxRowsB = (() => {
    const promoRatio = generalSubtotalBuilder > 0 ? discountedGeneral / generalSubtotalBuilder : 1;
    const groups: Record<number, number> = {};
    items.filter(i => i.fiscalRegime !== "reav").forEach(item => {
      const rate = (item as any).taxRate ?? 21;
      groups[rate] = (groups[rate] ?? 0) + item.total * promoRatio;
    });
    return Object.entries(groups).map(([rateStr, gross]) => {
      const rate = Number(rateStr);
      const div = 1 + rate / 100;
      return { rate, amount: parseFloat((gross - gross / div).toFixed(2)) };
    }).sort((a, b) => b.rate - a.rate);
  })();
  const taxAmount = parseFloat(taxRowsB.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateB = taxRowsB.length === 1 ? taxRowsB[0].rate : taxRate;
  const total = parseFloat((discountedSubtotal + taxAmount).toFixed(2));

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const updated = { ...item, [field]: value };
        if (field === "quantity" || field === "unitPrice") {
          updated.total = Number(updated.quantity) * Number(updated.unitPrice);
        }
        return updated;
      })
    );
  };

  const sendQuote = trpc.crm.quotes.send.useMutation({
    onSuccess: () => toast.success("Presupuesto enviado al cliente"),
    onError: (e) => toast.error(e.message),
  });

  const upsertPlanBuilder = trpc.crm.paymentPlans.upsert.useMutation({
    onError: (e) => toast.error(`Plan de pago: ${e.message}`),
  });

  const convertToQuote = trpc.crm.leads.convertToQuote.useMutation({
    onSuccess: async (data) => {
      toast.success(`Presupuesto ${data.quoteNumber} creado`);
      utils.crm.leads.counters.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.quotes.list.invalidate();
      if (draftInstallments.length > 0) {
        await upsertPlanBuilder.mutateAsync({
          quoteId: data.quoteId,
          installments: draftInstallments.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
        });
        toast.success(`Plan fraccionado guardado (${draftInstallments.length} cuotas)`);
      }
      if (sendAfterCreate) {
        await sendQuote.mutateAsync({ id: data.quoteId, origin: window.location.origin });
      }
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = (andSend = false) => {
    if (!title || items.some((i) => !i.description)) {
      toast.error("Completa el título y todos los conceptos");
      return;
    }
    if (draftInstallments.some(i => !i.dueDate || i.amountCents <= 0)) {
      toast.error("Completa el importe y la fecha de todas las cuotas del plan");
      return;
    }
    setSendAfterCreate(andSend);
    convertToQuote.mutate({
      leadId,
      title,
      description,
      items,
      subtotal,
      discount: promoDiscount,
      taxRate,
      total,
      validUntil,
      notes,
      conditions,
    });
  };

  return (
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-400" /> Nuevo Presupuesto
          {leadName && <span className="text-foreground/50 text-sm font-normal ml-1">para {leadName}</span>}
        </DialogTitle>
      </DialogHeader>
      {/* Boton Autogenerar con IA */}
      <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
        <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className="text-emerald-300 text-sm flex-1">
          {autoFilled ? "Conceptos generados desde las actividades del lead" : "Autogenera los conceptos del presupuesto desde las actividades seleccionadas"}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/60 shrink-0"
          onClick={handleAutoFill}
          disabled={previewQuery.isFetching}
        >
          {previewQuery.isFetching
            ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />
            : <Sparkles className="w-3.5 h-3.5 mr-1" />}
          {autoFilled ? "Regenerar" : "Autogenerar con IA"}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-foreground/65 text-xs">Asunto del presupuesto *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1"
            />
            <p className="text-foreground/40 text-xs mt-1">Generado automáticamente. Puedes editarlo.</p>
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Válido hasta</Label>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"
            />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="0" className="text-white">0% (exento)</SelectItem>
                <SelectItem value="10" className="text-white">10%</SelectItem>
                <SelectItem value="21" className="text-white">21%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Items con buscador de productos */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">
              Conceptos * <span className="text-foreground/40">(escribe o busca un producto)</span>
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }])}
            >
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[460px]">
          <div className="text-xs text-foreground/40 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-4">Descripción</span>
            <span className="col-span-2 text-center">Régimen</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4">
                  <ProductSearchInput
                    value={item.description}
                    onChange={(v) => updateItem(idx, "description", v)}
                    onSelect={(p) => {
                      setItems((prev) => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const unitPrice = Number(p.basePrice);
                        const fr = p.fiscalRegime === "reav" ? "reav" : "general";
                        const tr = Number(p.taxRate ?? 21);
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity, fiscalRegime: fr, taxRate: tr };
                      }));
                    }}
                  />
                </div>
                <select
                  className="col-span-2 bg-foreground/[0.05] border border-foreground/[0.12] text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime === "reav" ? "reav" : (item as any).taxRate === 10 ? "general_10" : "general"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: (e.target.value === "reav" ? "reav" : "general"), taxRate: (e.target.value === "general_10" ? 10 : e.target.value === "reav" ? 0 : 21) } : it))}
                >
                  <option value="general" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="general_10" className="bg-[#0d1526]">IVA 10%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input
                  className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-center"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                />
                <Input
                  className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-right"
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-amber-400" : "text-orange-400"}`}>
                  {item.total.toFixed(2)} €
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="col-span-1 text-foreground/40 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>

        {/* Código promocional */}
        <div className="bg-foreground/[0.05] rounded-xl p-3">
          <Label className="text-foreground/65 text-xs mb-1.5 block">Código de descuento (opcional)</Label>
          {promoData ? (
            <div className="flex items-center justify-between bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
              <span className="font-mono font-bold text-green-400 text-sm">{promoData.code} — -{promoData.discountPercent}%</span>
              <button onClick={() => { setPromoData(null); setPromoInput(""); }} className="text-foreground/50 hover:text-red-400 text-xs ml-2">× Quitar</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm font-mono uppercase"
                placeholder="VERANO25"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && validatePromo.mutate({ code: promoInput })}
              />
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700 text-white shrink-0" onClick={() => validatePromo.mutate({ code: promoInput })} disabled={validatePromo.isPending || !promoInput.trim()}>
                {validatePromo.isPending ? "..." : "Aplicar"}
              </Button>
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal rég. general</span><span>{generalSubtotalBuilder.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotalBuilder).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {promoDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-400"><span>Descuento {promoData?.code}</span><span>-{promoDiscount.toFixed(2)} €</span></div>
          )}
          {taxRowsB.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>IVA ({row.rate}%)</span><span>{row.amount.toFixed(2)} €</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-foreground/[0.12] pt-2 mt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        <div>
          <Label className="text-foreground/65 text-xs">Notas para el cliente</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Información adicional visible para el cliente..."
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1 resize-none h-16 text-sm"
          />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">Condiciones</Label>
          <Textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-12 text-sm"
          />
        </div>
      </div>

      {/* ─── PLAN DE PAGO FRACCIONADO (opcional) ─── */}
      <div className="border border-foreground/[0.10] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPlanSection(!showPlanSection)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm hover:bg-foreground/[0.04] transition-colors"
        >
          <span className="flex items-center gap-2 text-violet-300 font-medium">
            <CreditCard className="w-4 h-4" />
            Plan de pago fraccionado
            {draftInstallments.length > 0 && (
              <span className="bg-violet-500/20 text-violet-300 border border-violet-500/30 text-xs px-1.5 py-0.5 rounded-full">
                {draftInstallments.length} cuota{draftInstallments.length !== 1 ? "s" : ""}
              </span>
            )}
          </span>
          <span className="text-foreground/40 text-xs">{showPlanSection ? "▲ ocultar" : "▼ opcional"}</span>
        </button>
        {showPlanSection && (
          <div className="px-4 pb-4 space-y-3 border-t border-foreground/[0.08]">
            <p className="text-xs text-foreground/45 pt-3">Define las cuotas ahora. Se guardarán automáticamente al crear el presupuesto.</p>
            {draftInstallments.map((inst, idx) => (
              <div key={idx} className="space-y-1.5 py-1.5 border-b border-foreground/[0.07] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-foreground/40 w-5 shrink-0">#{idx + 1}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Importe (€)"
                    value={inst._amountStr ?? (inst.amountCents > 0 ? (inst.amountCents / 100).toFixed(2) : "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      const cents = Math.round(parseFloat(val.replace(",", ".") || "0") * 100) || 0;
                      const updated = [...draftInstallments];
                      updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                      if (idx + 1 < updated.length) {
                        const totalCents = Math.round(total * 100);
                        const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                        const remaining = Math.max(0, totalCents - sumOthers);
                        updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                      }
                      setDraftInstallments(updated);
                    }}
                    className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white placeholder:text-foreground/40 focus:outline-none focus:border-violet-500/50"
                  />
                  <input
                    type="date"
                    value={inst.dueDate}
                    onChange={(e) => {
                      const updated = [...draftInstallments];
                      updated[idx] = { ...updated[idx], dueDate: e.target.value };
                      setDraftInstallments(updated);
                    }}
                    className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500/50"
                  />
                </div>
                <div className="flex items-center justify-between pl-7">
                  <label className="flex items-center gap-1.5 text-xs text-violet-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={inst.isRequiredForConfirmation}
                      onChange={(e) => {
                        const updated = [...draftInstallments];
                        updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                        setDraftInstallments(updated);
                      }}
                      className="accent-violet-500 shrink-0"
                    />
                    Cuota inaplazable
                  </label>
                  <button onClick={() => setDraftInstallments(draftInstallments.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 text-xs">✕ Eliminar</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const totalCents = Math.round(total * 100);
                const sumExisting = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                const remaining = Math.max(0, totalCents - sumExisting);
                setDraftInstallments([...draftInstallments, {
                  installmentNumber: draftInstallments.length + 1,
                  amountCents: remaining,
                  _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                  dueDate: "",
                  isRequiredForConfirmation: draftInstallments.length === 0,
                  notes: "",
                }]);
              }}
              className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
            >+ Añadir cuota</button>
            {draftInstallments.length > 0 && (() => {
              const sum = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
              const totalCents = Math.round(total * 100);
              const diff = Math.abs(sum - totalCents);
              return (
                <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                  <span>Suma cuotas: {(sum / 100).toFixed(2)} €</span>
                  <span>Total: {total.toFixed(2)} €</span>
                  {diff > 1 && <span>⚠ Dif: {(diff / 100).toFixed(2)} €</span>}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => handleSubmit(false)}
          disabled={convertToQuote.isPending}
          className="bg-foreground/[0.08] hover:bg-foreground/[0.15] text-white border border-foreground/[0.15]"
        >
          {convertToQuote.isPending && !sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
          Guardar borrador
        </Button>
        <Button
          size="sm"
          onClick={() => handleSubmit(true)}
          disabled={convertToQuote.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
        >
          {convertToQuote.isPending && sendAfterCreate ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
          Crear y Enviar al cliente
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── QUOTE EDIT MODAL ────────────────────────────────────────────────────────

// ─── PRODUCT AUTOCOMPLETE FIELD ─────────────────────────────────────────────
function ProductAutocompleteInput({
  value,
  onChange,
  onSelect,
  placeholder = "Descripción o busca un producto...",
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (product: { title: string; unitPrice: number; fiscalRegime: "reav" | "general" }) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincronizar query cuando value cambia externamente
  useEffect(() => { setQuery(value); }, [value]);

  const { data, isFetching } = trpc.crm.catalog.search.useQuery(
    { q: query },
    { enabled: open && query.trim().length >= 1, staleTime: 2000 }
  );

  const results = data?.results ?? [];

  // Cerrar al hacer clic fuera
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const TYPE_LABELS: Record<string, string> = {
    experience: "Actividad",
    pack: "Pack",
    legopack: "Lego Pack",
  };
  const TYPE_COLORS: Record<string, string> = {
    experience: "text-blue-400",
    pack: "text-emerald-400",
    legopack: "text-violet-400",
  };

  return (
    <div ref={containerRef} className="relative col-span-4">
      <Input
        className="w-full bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(e.target.value.trim().length >= 1);
        }}
        onFocus={() => { if (query.trim().length >= 1) setOpen(true); }}
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-foreground/[0.15] rounded-lg shadow-2xl overflow-hidden">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-foreground/50">
              <RefreshCw className="w-3 h-3 animate-spin" /> Buscando...
            </div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-foreground/40">Sin resultados para "{query}"</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-foreground/[0.08] transition-colors text-left group"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(r.title);
                onChange(r.title);
                onSelect({ title: r.title, unitPrice: r.unitPrice, fiscalRegime: r.fiscalRegime });
                setOpen(false);
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-semibold shrink-0 ${TYPE_COLORS[r.type] ?? "text-foreground/50"}`}>
                  {TYPE_LABELS[r.type] ?? r.type}
                </span>
                <span className="text-sm text-white truncate group-hover:text-orange-300 transition-colors">{r.title}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.fiscalRegime === "reav" && (
                  <span className="text-[10px] text-amber-400 font-semibold">REAV</span>
                )}
                <span className="text-sm font-semibold text-orange-400">{r.unitPrice.toFixed(2)} €</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuoteEditModal({
  quoteId,
  onClose,
}: {
  quoteId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.crm.quotes.get.useQuery({ id: quoteId });
  const [title, setTitle] = useState("");
  const [conditions, setConditions] = useState("");
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState(21);
  const [validUntil, setValidUntil] = useState("");
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]>([]);
  const [discount, setDiscount] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // ── Aplicar bono/código ──
  const [showBonoPanel, setShowBonoPanel] = useState(false);
  const [bonoCode, setBonoCode] = useState("");
  const [bonoQueryCode, setBonoQueryCode] = useState<string | null>(null);

  const { data: bonoPreview, isFetching: bonoFetching } = trpc.discounts.verifyVoucher.useQuery(
    { code: bonoQueryCode ?? "" },
    { enabled: !!bonoQueryCode }
  );

  const applyDiscountCodeMut = trpc.crm.quotes.applyDiscountCode.useMutation({
    onSuccess: (result) => {
      toast.success(`Bono ${result.code} aplicado — ${result.discountEur.toFixed(2)} € descontados`);
      setDiscount(result.discountEur);
      setShowBonoPanel(false);
      setBonoCode("");
      setBonoQueryCode(null);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (data && !initialized) {
    const q = data.quote;
    setTitle(q.title ?? "");
    setConditions(q.conditions ?? "");
    setNotes(q.notes ?? "");
    setTaxRate(q.tax ? parseFloat(String(q.tax)) : 21);
    setValidUntil(q.validUntil ? new Date(q.validUntil).toISOString().split("T")[0] : "");
    const rawItems = (q.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
    setItems(rawItems.length > 0 ? rawItems : [{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }]);
    setDiscount(Number(q.discount ?? 0));
    setInitialized(true);
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotalEdit = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const discountedBase = Math.max(0, generalSubtotalEdit - discount);
  const taxRowsE = (() => {
    const discountRatio = generalSubtotalEdit > 0 ? discountedBase / generalSubtotalEdit : 1;
    const groups: Record<number, number> = {};
    items.filter(i => i.fiscalRegime !== "reav").forEach(item => {
      const rate = (item as any).taxRate ?? 21;
      groups[rate] = (groups[rate] ?? 0) + item.total * discountRatio;
    });
    return Object.entries(groups).map(([rateStr, gross]) => {
      const rate = Number(rateStr);
      const div = 1 + rate / 100;
      return { rate, amount: parseFloat((gross - gross / div).toFixed(2)) };
    }).sort((a, b) => b.rate - a.rate);
  })();
  const taxAmount = parseFloat(taxRowsE.reduce((s, r) => s + r.amount, 0).toFixed(2));
  const effectiveTaxRateE = taxRowsE.length === 1 ? taxRowsE[0].rate : taxRate;
  const total = parseFloat((subtotal - discount + taxAmount).toFixed(2));

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") updated.total = Number(updated.quantity) * Number(updated.unitPrice);
      return updated;
    }));
  };

  // Seleccionar producto del catálogo: rellena descripción, precio y régimen
  const selectCatalogProduct = (idx: number, product: CatalogProduct) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = item.quantity || 1;
      const unitPrice = Number(product.basePrice);
      const fiscalRegime = product.fiscalRegime === "reav" ? "reav" : "general";
      return {
        ...item,
        description: product.title,
        unitPrice,
        fiscalRegime,
        taxRate: product.taxRate ? Number(product.taxRate) : 21,
        total: qty * unitPrice,
      };
    }));
  };

  const updateQuote = trpc.crm.quotes.update.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto actualizado");
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.get.invalidate({ id: quoteId });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !initialized) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Pencil className="w-4 h-4 text-orange-400" /> Editar Presupuesto
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-foreground/65 text-xs">Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">Válido hasta</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1" />
          </div>
          <div>
            <Label className="text-foreground/65 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                <SelectItem value="0" className="text-white">0% (exento)</SelectItem>
                <SelectItem value="10" className="text-white">10%</SelectItem>
                <SelectItem value="21" className="text-white">21%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-foreground/65 text-xs">Conceptos *</Label>
            <Button size="sm" variant="ghost" className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general" }])}>
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="overflow-x-auto -mx-1 px-1">
          <div className="min-w-[460px]">
          <div className="text-xs text-foreground/40 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-4">Descripción</span>
            <span className="col-span-2 text-center">Régimen</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <CatalogConceptSelector
                  value={item.description}
                  onChange={(v) => updateItem(idx, "description", v)}
                  onSelectProduct={(product) => selectCatalogProduct(idx, product)}
                  className="col-span-4"
                  inputClassName="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm pr-8"
                  showBadge={false}
                />
                <select
                  className="col-span-2 bg-foreground/[0.05] border border-foreground/[0.12] text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime === "reav" ? "reav" : (item as any).taxRate === 10 ? "general_10" : "general"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: (e.target.value === "reav" ? "reav" : "general"), taxRate: (e.target.value === "general_10" ? 10 : e.target.value === "reav" ? 0 : 21) } : it))}
                >
                  <option value="general" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="general_10" className="bg-[#0d1526]">IVA 10%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-amber-400" : "text-orange-400"}`}>{item.total.toFixed(2)} €</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-foreground/40 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </div>
        <div className="bg-foreground/[0.05] rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal rég. general</span><span>{generalSubtotalEdit.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotalEdit).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-foreground/65"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {discount > 0 && (
            <div className="flex justify-between text-sm text-purple-300">
              <span className="flex items-center gap-1"><Gift className="w-3 h-3" /> Descuento / bono</span>
              <span>−{discount.toFixed(2)} €</span>
            </div>
          )}
          {taxRowsE.map(row => (
            <div key={row.rate} className="flex justify-between text-sm text-foreground/65"><span>IVA ({row.rate}%)</span><span>{row.amount.toFixed(2)} €</span></div>
          ))}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-foreground/[0.12] pt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        {/* ── Panel: Aplicar bono / código de descuento ── */}
        {discount === 0 && (
          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
            <button
              type="button"
              className="w-full flex items-center justify-between text-xs font-semibold text-purple-300 uppercase tracking-wider"
              onClick={() => setShowBonoPanel((v) => !v)}
            >
              <span className="flex items-center gap-2"><Gift className="w-3.5 h-3.5" /> Aplicar bono / código de descuento</span>
              <span className="text-purple-400/60">{showBonoPanel ? "▲" : "▼"}</span>
            </button>
            {showBonoPanel && (
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={bonoCode}
                    onChange={(e) => { setBonoCode(e.target.value.toUpperCase()); setBonoQueryCode(null); }}
                    placeholder="Ej: BON-A1B2-C3D4"
                    className="bg-[#0a0a1a] border-foreground/[0.12] text-white placeholder:text-gray-600 font-mono text-xs h-8 flex-1"
                    spellCheck={false}
                  />
                  <Button size="sm" variant="outline"
                    className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 h-8 px-3"
                    disabled={bonoCode.trim().length < 3 || bonoFetching}
                    onClick={() => setBonoQueryCode(bonoCode.trim())}
                  >
                    {bonoFetching ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  </Button>
                </div>
                {bonoPreview && !bonoPreview.found && (
                  <p className="text-red-400 text-xs">Código no encontrado.</p>
                )}
                {bonoPreview?.found && (
                  <div className={`rounded-lg border p-3 space-y-2 text-xs ${
                    bonoPreview.status === "canjeado" ? "border-gray-500/20 bg-gray-500/5" :
                    bonoPreview.status === "caducado" ? "border-red-500/20 bg-red-500/5" :
                    "border-purple-500/20 bg-purple-500/5"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-foreground">{bonoPreview.code}</span>
                      <span className={`font-semibold px-2 py-0.5 rounded-full text-xs ${
                        bonoPreview.status === "canjeado" ? "text-gray-400 bg-gray-500/10" :
                        bonoPreview.status === "caducado" ? "text-red-400 bg-red-500/10" :
                        "text-purple-300 bg-purple-500/10"
                      }`}>
                        {bonoPreview.status === "canjeado" ? "Ya canjeado" : bonoPreview.status === "caducado" ? "Caducado" : "Activo"}
                      </span>
                    </div>
                    {bonoPreview.value > 0 && <p className="text-white font-bold">{bonoPreview.value.toFixed(2)} € de descuento</p>}
                    {bonoPreview.activityName && <p className="text-foreground/50">{bonoPreview.activityName}</p>}
                    {(bonoPreview.status === "enviado" || bonoPreview.status === "generado") && (
                      <Button size="sm" className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs h-7"
                        disabled={applyDiscountCodeMut.isPending}
                        onClick={() => applyDiscountCodeMut.mutate({ id: quoteId, code: bonoPreview.code })}
                      >
                        {applyDiscountCodeMut.isPending ? "Aplicando..." : `Confirmar — descontar ${bonoPreview.value.toFixed(2)} €`}
                      </Button>
                    )}
                    {bonoPreview.status !== "enviado" && bonoPreview.status !== "generado" && (
                      <p className="text-red-400">Este bono no puede aplicarse ({bonoPreview.status}).</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div>
          <Label className="text-foreground/65 text-xs">Notas para el cliente</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-foreground/65 text-xs">Condiciones</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} className="bg-foreground/[0.05] border-foreground/[0.12] text-white mt-1 resize-none h-12 text-sm" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
        <Button
          size="sm"
          onClick={() => updateQuote.mutate({ id: quoteId, title, conditions, notes, items: items.map(i => ({ ...i, taxRate: (i as any).taxRate ?? 21 })), subtotal, discount, taxRate: effectiveTaxRateE, total, validUntil })}
          disabled={updateQuote.isPending}
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
        >
          {updateQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
          Guardar cambios
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ─── QUOTE DETAIL MODAL ───────────────────────────────────────────────────────

// ─── QUOTE TIMELINE COMPONENT ────────────────────────────────────────────────

type TimelineEventType = "created" | "sent" | "viewed" | "reminder" | "accepted" | "rejected" | "paid" | "lost" | "expired" | "activity";

const TIMELINE_CONFIG: Record<TimelineEventType, { icon: React.ReactNode; color: string; bg: string }> = {
  created:  { icon: <FileText className="w-3.5 h-3.5" />, color: "text-foreground/65", bg: "bg-foreground/[0.08]" },
  sent:     { icon: <Send className="w-3.5 h-3.5" />, color: "text-blue-400", bg: "bg-blue-500/20" },
  viewed:   { icon: <Eye className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  reminder: { icon: <RefreshCw className="w-3.5 h-3.5" />, color: "text-amber-400", bg: "bg-amber-500/20" },
  accepted: { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  rejected: { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-red-400", bg: "bg-red-500/20" },
  paid:     { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-orange-400", bg: "bg-orange-500/20" },
  lost:     { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-red-400", bg: "bg-red-500/20" },
  expired:  { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-foreground/50", bg: "bg-foreground/[0.08]" },
  activity: { icon: <ArrowUpRight className="w-3.5 h-3.5" />, color: "text-purple-400", bg: "bg-purple-500/20" },
};

function QuoteTimeline({ quoteId }: { quoteId: number }) {
  const { data, isLoading } = trpc.crm.timeline.get.useQuery({ quoteId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 animate-spin text-foreground/40" />
      </div>
    );
  }

  if (!data || data.events.length === 0) {
    return <p className="text-xs text-foreground/40 text-center py-4">Sin actividad registrada</p>;
  }

  return (
    <div className="relative">
      {/* Línea vertical */}
      <div className="absolute left-[15px] top-0 bottom-0 w-px bg-foreground/[0.08]" />
      <div className="space-y-3">
        {data.events.map((event, idx) => {
          const cfg = TIMELINE_CONFIG[event.type as TimelineEventType] ?? TIMELINE_CONFIG.activity;
          const isLast = idx === data.events.length - 1;
          return (
            <div key={event.id} className="flex gap-3 relative">
              {/* Icono */}
              <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg} ${cfg.color} border border-foreground/[0.12]`}>
                {cfg.icon}
              </div>
              {/* Contenido */}
              <div className={`flex-1 pb-3 ${isLast ? "" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-medium ${cfg.color}`}>{event.label}</span>
                  <span className="text-xs text-foreground/40 whitespace-nowrap flex-shrink-0">
                    {new Date(event.timestamp).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-foreground/50 mt-0.5">{event.detail}</p>
                )}
                {event.actor && (
                  <p className="text-xs text-foreground/40 mt-0.5">Por: {event.actor}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── QUOTE DETAIL MODAL ───────────────────────────────────────────────────────

function QuoteDetailModal({
  quoteId,
  onClose,
}: {
  quoteId: number;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.crm.quotes.get.useQuery({ id: quoteId });
  const [paymentLink, setPaymentLink] = useState("");
  const [showPaymentInput, setShowPaymentInput] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  // Payment plan state
  const [showPlanEditor, setShowPlanEditor] = useState(false);
  type DraftInstallment = { installmentNumber: number; amountCents: number; _amountStr?: string; dueDate: string; isRequiredForConfirmation: boolean; notes: string };
  const [draftInstallments, setDraftInstallments] = useState<DraftInstallment[]>([]);
  const [planEditMode, setPlanEditMode] = useState(false);
  // Transfer proof modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferProofUrl, setTransferProofUrl] = useState<string | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
  // FASE 2A: banco movement linking (transfer modal)
  const [selectedBankMovementId, setSelectedBankMovementId] = useState<number | null>(null);
  const [showBankMovementSearch, setShowBankMovementSearch] = useState(false);
  const [bankMovementSearch, setBankMovementSearch] = useState("");
  // FASE 2A: banco movement linking (confirm payment modal)
  const [selectedBankMovementIdForConfirm, setSelectedBankMovementIdForConfirm] = useState<number | null>(null);
  const [showBankMovementSearchForConfirm, setShowBankMovementSearchForConfirm] = useState(false);
  const [bankMovementSearchForConfirm, setBankMovementSearchForConfirm] = useState("");
  // TPV op linking (confirm payment modal)
  const [selectedTpvOpIdForConfirm, setSelectedTpvOpIdForConfirm] = useState<number | null>(null);
  const [showTpvOpSearchForConfirm, setShowTpvOpSearchForConfirm] = useState(false);
  const [tpvOpSearchForConfirm, setTpvOpSearchForConfirm] = useState("");
  // Unified payment modal state
  const [showConfirmPaymentModal, setShowConfirmPaymentModal] = useState(false);
  const [paymentMethodSelected, setPaymentMethodSelected] = useState<"tarjeta" | "transferencia" | "efectivo">("tarjeta");
  const [viewTpvOp, setViewTpvOp] = useState("");
  const [viewPayNote, setViewPayNote] = useState("");
  const [viewProofUrl, setViewProofUrl] = useState<string | null>(null);
  const [viewProofKey, setViewProofKey] = useState<string | null>(null);
  const [isUploadingViewProof, setIsUploadingViewProof] = useState(false);
  // Pending payment modal state
  const [showPendingPaymentModal, setShowPendingPaymentModal] = useState(false);
  const [pendingDueDate, setPendingDueDate] = useState("");
  const [pendingReason, setPendingReason] = useState("");
  // Per-installment manual confirmation mini-modal
  const [confirmingInstallment, setConfirmingInstallment] = useState<{ id: number; installmentNumber: number; amountCents: number } | null>(null);
  const [instPayMethod, setInstPayMethod] = useState<"tarjeta_fisica" | "transferencia" | "efectivo">("transferencia");
  const [instTpvOp, setInstTpvOp] = useState("");
  const [instPayNote, setInstPayNote] = useState("");
  const [instProofUrl, setInstProofUrl] = useState<string | null>(null);
  const [instProofKey, setInstProofKey] = useState<string | null>(null);
  const [isUploadingInstProof, setIsUploadingInstProof] = useState(false);

  const sendQuote = trpc.crm.quotes.send.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto enviado al cliente");
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendQuote = trpc.crm.quotes.resend.useMutation({
    onSuccess: () => toast.success("Presupuesto reenviado"),
    onError: (e) => toast.error(e.message),
  });

  const confirmPayment = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      toast.success(`Pago confirmado · Factura ${data.invoiceNumber} generada`);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const markLost = trpc.crm.quotes.markLost.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto marcado como perdido");
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  const duplicate = trpc.crm.quotes.duplicate.useMutation({
    onSuccess: (d) => {
      toast.success(`Copia creada: ${d.quoteNumber}`);
      utils.crm.quotes.counters.invalidate();
      onClose();
    },
  });

  const convertToReservation = trpc.crm.quotes.convertToReservation.useMutation({
    onSuccess: () => {
      toast.success("Reserva creada · Pendiente de cobro");
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const generatePdf = trpc.crm.quotes.generatePdf.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const uploadTransferProof = trpc.crm.quotes.uploadTransferProof.useMutation({
    onSuccess: (data) => {
      setTransferProofUrl(data.url);
      toast.success("Justificante subido correctamente");
    },
    onError: (e) => toast.error(e.message),
  });
  const confirmTransfer = trpc.crm.quotes.confirmTransfer.useMutation({
    onSuccess: (data) => {
      toast.success(`Pago por transferencia confirmado · Factura ${data.invoiceNumber} generada`);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      setShowTransferModal(false);
      setSelectedBankMovementId(null);
      setShowBankMovementSearch(false);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // FASE 2A: movimientos bancarios pendientes para vincular (transfer modal)
  const bankMovementsQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearch || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearch && showTransferModal }
  );
  // FASE 2A: movimientos bancarios pendientes para vincular (confirm payment modal)
  const bankMovementsForConfirmQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearchForConfirm || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearchForConfirm && showConfirmPaymentModal && paymentMethodSelected === "transferencia" }
  );
  // TPV ops pendientes para vincular (confirm payment modal — Modal 1)
  const tpvOpsForConfirmQ = trpc.cardTerminalOperations.list.useQuery(
    { status: "pendiente", search: tpvOpSearchForConfirm || undefined, pageSize: 20, page: 1 },
    { enabled: showTpvOpSearchForConfirm && showConfirmPaymentModal && paymentMethodSelected === "tarjeta" }
  );
  const createPendingPayment = trpc.crm.pendingPayments.create.useMutation({
    onSuccess: () => {
      toast.success("Pago pendiente registrado · Email enviado al cliente");
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      setShowPendingPaymentModal(false);
      setPendingDueDate("");
      setPendingReason("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const planQuery = trpc.crm.paymentPlans.get.useQuery({ quoteId }, { enabled: showPlanEditor || !!data?.quote?.paymentPlanId });
  const upsertPlan = trpc.crm.paymentPlans.upsert.useMutation({
    onSuccess: () => {
      toast.success("Plan de pago guardado");
      planQuery.refetch();
      setPlanEditMode(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const deletePlan = trpc.crm.paymentPlans.delete.useMutation({
    onSuccess: () => {
      toast.success("Plan de pago eliminado");
      planQuery.refetch();
      setDraftInstallments([]);
      setPlanEditMode(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const confirmInstallmentMut = trpc.crm.paymentPlans.confirmInstallment.useMutation({
    onSuccess: () => {
      toast.success("Cuota confirmada");
      setConfirmingInstallment(null);
      setInstPayMethod("transferencia");
      setInstTpvOp("");
      setInstPayNote("");
      setInstProofUrl(null);
      setInstProofKey(null);
      planQuery.refetch();
      utils.crm.quotes.get.invalidate({ id: quoteId });
    },
    onError: (e) => toast.error(e.message),
  });
  const generateInstallmentLink = trpc.crm.paymentPlans.generateInstallmentLink.useMutation({
    onSuccess: (d) => toast.success(`Enlace enviado al cliente — Cuota #${d.installmentNumber}`),
    onError: (e) => toast.error(e.message),
  });

  const confirmPaymentWithMethod = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      const label = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "tarjeta";
      toast.success(`Pago confirmado (${label}) · Factura ${(data as { invoiceNumber?: string })?.invoiceNumber ?? ""} generada`);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      if (selectedBankMovementIdForConfirm) utils.bankMovements.listMovements.invalidate();
      if (selectedTpvOpIdForConfirm) utils.cardTerminalOperations.list.invalidate();
      setShowConfirmPaymentModal(false);
      setSelectedBankMovementIdForConfirm(null);
      setShowBankMovementSearchForConfirm(false);
      setBankMovementSearchForConfirm("");
      setSelectedTpvOpIdForConfirm(null);
      setShowTpvOpSearchForConfirm(false);
      setTpvOpSearchForConfirm("");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadProofOnly = trpc.crm.quotes.uploadProofOnly.useMutation({
    onError: (e) => toast.error(`Error al subir el justificante: ${e.message}`),
  });

  const handleViewProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Solo se permiten archivos JPG, PNG o PDF"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("El archivo no puede superar 10 MB"); return; }
    setIsUploadingViewProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        const result = await uploadProofOnly.mutateAsync({
          quoteId,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setViewProofUrl(result.url);
        setViewProofKey(result.fileKey);
        setIsUploadingViewProof(false);
        toast.success("Justificante subido correctamente");
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingViewProof(false);
    }
  };

  const handleTransferFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Solo se permiten archivos JPG, PNG o PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("El archivo no puede superar 10 MB");
      return;
    }
    setTransferFile(file);
    setIsUploadingProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        await uploadTransferProof.mutateAsync({
          quoteId,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setIsUploadingProof(false);
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingProof(false);
    }
  };

  const downloadPdf = async () => {
    try {
      const result = await generatePdf.mutateAsync({ id: quoteId });
      const a = document.createElement("a");
      a.href = result.pdfUrl;
      a.download = result.filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("PDF generado correctamente");
    } catch (_) { /* error ya mostrado */ }
  };

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { quote, lead, invoices: relatedInvoices } = data;
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general" }[]) ?? [];
  const reavItems = items.filter(i => i.fiscalRegime === "reav");
  const generalItems = items.filter(i => i.fiscalRegime !== "reav");
  const hasReav = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  return (
    <>
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
      <div className="overflow-y-auto flex-1 px-6 pt-6 pb-2">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-700/20 border border-orange-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="font-bold">{quote.quoteNumber}</div>
            <div className="text-sm text-foreground/60 font-normal">{lead?.name ?? "Cliente"}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <QuoteStatusBadge status={quote.status as QuoteStatus} />
          {quote.isAutoGenerated && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2.5 py-1 rounded-full"
              title="Este presupuesto fue generado automáticamente desde las actividades seleccionadas en el formulario"
            >
              <Sparkles className="w-3 h-3" />
              Generado con IA
            </span>
          )}
          {quote.sentAt && <span className="text-xs text-foreground/50">Enviado {new Date(quote.sentAt).toLocaleDateString("es-ES")}</span>}
          {quote.viewedAt && <span className="text-xs text-emerald-400">Visto ✓</span>}
        </div>

        <div className="bg-foreground/[0.05] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-foreground/[0.12]">
            <h3 className="font-semibold text-white text-sm">{quote.title}</h3>
            {quote.description && <p className="text-xs text-foreground/60 mt-0.5">{quote.description}</p>}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-foreground/[0.05]">
                <th className="text-left px-4 py-2 text-xs text-foreground/50 font-medium">Concepto</th>
                <th className="text-center px-4 py-2 text-xs text-foreground/50 font-medium">Cant.</th>
                <th className="text-right px-4 py-2 text-xs text-foreground/50 font-medium">P.Unit.</th>
                <th className="text-right px-4 py-2 text-xs text-foreground/50 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {hasGeneral && hasReav && (
                <tr className="border-t border-foreground/[0.08] bg-blue-500/5">
                  <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-blue-300 uppercase tracking-wider">Régimen General (IVA 21%)</td>
                </tr>
              )}
              {(hasGeneral && hasReav ? generalItems : items).map((item, i) => (
                <tr key={i} className="border-t border-foreground/[0.08]">
                  <td className="px-4 py-2.5 text-sm text-foreground/80">{item.description}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground/65 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-foreground/65 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-orange-400 text-right">{Number(item.total).toFixed(2)} €</td>
                </tr>
              ))}
              {hasReav && (
                <>
                  <tr className="border-t border-foreground/[0.08] bg-amber-500/5">
                    <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-amber-300 uppercase tracking-wider">REAV — Sin IVA (Régimen Especial Agencias de Viaje)</td>
                  </tr>
                  {reavItems.map((item, i) => (
                    <tr key={`reav-${i}`} className="border-t border-foreground/[0.08]">
                      <td className="px-4 py-2.5 text-sm text-foreground/80">
                        {item.description}
                        <span className="ml-1.5 text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">REAV</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-foreground/65 text-center">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-sm text-foreground/65 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-amber-400 text-right">{Number(item.total).toFixed(2)} €</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-foreground/[0.12] space-y-1">
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-foreground/60">
                <span>Descuento</span><span>-{Number(quote.discount).toFixed(2)} €</span>
              </div>
            )}
            {hasGeneral && hasReav && (
              <>
                <div className="flex justify-between text-sm text-foreground/60">
                  <span>Subtotal rég. general</span><span>{generalItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-sm text-amber-400/70">
                  <span>Subtotal REAV (sin IVA)</span><span>{reavItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</span>
                </div>
              </>
            )}
            {Number(quote.tax) > 0 && (
              <div className="flex justify-between text-sm text-foreground/60">
                <span>IVA (21%)</span><span>{Number(quote.tax).toFixed(2)} €</span>
              </div>
            )}
            {hasReav && !hasGeneral && (
              <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-foreground">TOTAL</span>
              <span className="text-xl font-bold text-orange-400">{Number(quote.total).toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* Invoices */}
        {relatedInvoices.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Facturas generadas</h4>
            {relatedInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-emerald-400">{inv.invoiceNumber}</span>
                  <span className="text-xs text-foreground/50 ml-2">{new Date(inv.issuedAt).toLocaleDateString("es-ES")}</span>
                </div>
                {inv.pdfUrl && (
                  <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="ghost" className="text-emerald-400 hover:text-emerald-300 h-7 text-xs">
                      <Download className="w-3.5 h-3.5 mr-1" /> Descargar
                    </Button>
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Timeline de actividad */}
        <div>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="flex items-center gap-2 text-xs text-foreground/50 hover:text-foreground/70 transition-colors w-full py-1"
          >
            <div className="flex-1 h-px bg-foreground/[0.08]" />
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-foreground/[0.05] hover:bg-foreground/[0.08] transition-colors">
              <Eye className="w-3 h-3" />
              {showTimeline ? "Ocultar historial" : "Ver historial de actividad"}
            </span>
            <div className="flex-1 h-px bg-foreground/[0.08]" />
          </button>
          {showTimeline && (
            <div className="mt-3 pl-1">
              <QuoteTimeline quoteId={quoteId} />
            </div>
          )}
        </div>

        {/* Payment link input */}
        {showPaymentInput && (
          <div>
            <Label className="text-foreground/65 text-xs">Link de pago (opcional)</Label>
            <Input
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="https://..."
              className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 mt-1 text-sm"
            />
          </div>
        )}

        {/* ─── RESUMEN PLAN DE PAGOS (siempre visible si existe) ─── */}
        {!showPlanEditor && planQuery.data && planQuery.data.installments.length > 0 && (
          <div className="bg-violet-950/30 border border-violet-500/30 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-violet-400" />
                Plan de Pago Fraccionado
              </h4>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                planQuery.data.installments.every(i => i.status === "paid")
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : planQuery.data.installments.some(i => i.status === "paid")
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                  : "bg-violet-500/20 text-violet-300 border border-violet-500/30"
              }`}>
                {planQuery.data.installments.every(i => i.status === "paid")
                  ? "Completado"
                  : planQuery.data.installments.some(i => i.status === "paid")
                  ? "En curso"
                  : "Pendiente"}
              </span>
            </div>
            <div className="space-y-1">
              {planQuery.data.installments.map((inst) => (
                <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-b border-foreground/[0.06] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground/40 w-5">#{inst.installmentNumber}</span>
                    <span className={inst.status === "paid" ? "text-emerald-300 font-medium" : "text-foreground/80"}>
                      {(inst.amountCents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                    </span>
                    {inst.isRequiredForConfirmation && (
                      <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full">Inaplazable</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {inst.dueDate && <span className="text-foreground/40">{inst.dueDate}</span>}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                      inst.status === "paid"
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                        : "bg-foreground/[0.06] text-foreground/50 border-foreground/[0.12]"
                    }`}>
                      {inst.status === "paid" ? "Pagada" : "Pendiente"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {(() => {
              const paidTotal = planQuery.data.installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
              const pendingTotal = planQuery.data.installments.filter(i => i.status !== "paid").reduce((s, i) => s + i.amountCents, 0);
              const hasPending = pendingTotal > 0;
              return (
                <>
                  <div className="flex justify-between pt-1 text-xs text-foreground/60">
                    <span>Cobrado: <span className="text-emerald-300 font-medium">{(paidTotal / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span></span>
                    <span>Pendiente: <span className="text-amber-300 font-medium">{(pendingTotal / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span></span>
                  </div>
                  {hasPending && (
                    <button
                      onClick={() => generateInstallmentLink.mutate({ quoteId, origin: window.location.origin })}
                      disabled={generateInstallmentLink.isPending}
                      className="w-full mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-violet-300 border border-violet-500/40 hover:bg-violet-500/10 rounded-lg py-1.5 transition-colors disabled:opacity-50"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {generateInstallmentLink.isPending ? "Enviando..." : "Enviar enlace de pago al cliente"}
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ─── PLAN DE PAGO FRACCIONADO ─── */}
        {showPlanEditor && (
          <div className="bg-foreground/[0.04] border border-foreground/[0.10] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-violet-400" />
                Plan de Pago Fraccionado
              </h4>
              <div className="flex items-center gap-2">
                {planQuery.data && !planEditMode && (
                  <button
                    onClick={() => {
                      setDraftInstallments((planQuery.data?.installments ?? []).map(i => ({
                        installmentNumber: i.installmentNumber,
                        amountCents: i.amountCents,
                        dueDate: i.dueDate,
                        isRequiredForConfirmation: i.isRequiredForConfirmation,
                        notes: i.notes ?? "",
                      })));
                      setPlanEditMode(true);
                    }}
                    className="text-xs text-violet-400 hover:text-violet-300 underline"
                  >Editar</button>
                )}
                {planQuery.data && !planEditMode && (
                  <button
                    onClick={() => { if (confirm("¿Eliminar el plan de pago fraccionado?")) deletePlan.mutate({ quoteId }); }}
                    className="text-xs text-red-400 hover:text-red-300 underline"
                  >Eliminar</button>
                )}
                {planEditMode && (
                  <button onClick={() => setPlanEditMode(false)} className="text-xs text-foreground/50 hover:text-foreground underline">Cancelar</button>
                )}
              </div>
            </div>

            {/* Vista de cuotas existentes (solo lectura) */}
            {planQuery.data && !planEditMode && (
              <div className="space-y-2">
                {planQuery.data.installments.map((inst) => {
                  const isOverdue = inst.status === "overdue" || (inst.status === "pending" && inst.dueDate < new Date().toISOString().split("T")[0]);
                  return (
                    <div key={inst.id} className="flex items-center gap-3 py-2 border-b border-foreground/[0.08] last:border-0">
                      <span className="text-xs text-foreground/40 w-5">#{inst.installmentNumber}</span>
                      <span className="text-sm font-semibold text-white flex-1">{(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</span>
                      <span className="text-xs text-foreground/55">{inst.dueDate}</span>
                      {inst.isRequiredForConfirmation && <span className="text-xs bg-violet-500/15 text-violet-300 border border-violet-500/25 px-1.5 py-0.5 rounded">Requerida</span>}
                      {inst.status === "paid" ? (
                        <span className="text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-1.5 py-0.5 rounded">Pagada</span>
                      ) : inst.status === "cancelled" ? (
                        <span className="text-xs text-foreground/30">Cancelada</span>
                      ) : isOverdue ? (
                        <span className="text-xs bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded">Vencida</span>
                      ) : (
                        <button
                          onClick={() => setConfirmingInstallment({ id: inst.id, installmentNumber: inst.installmentNumber, amountCents: inst.amountCents })}
                          className="text-xs bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded transition-colors"
                        >
                          Confirmar pago
                        </button>
                      )}
                    </div>
                  );
                })}
                {(() => {
                  const total = planQuery.data.installments.reduce((s, i) => s + i.amountCents, 0);
                  const quoteTotalCents = Math.round(Number(quote.total ?? 0) * 100);
                  return (
                    <div className="flex justify-between items-center pt-1 text-xs text-foreground/50">
                      <span>Total plan: <strong className="text-white">{(total / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</strong></span>
                      {Math.abs(total - quoteTotalCents) > 1 && (
                        <span className="text-amber-400">⚠ Diferencia con presupuesto ({(quoteTotalCents / 100).toFixed(2)} €)</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Editor de cuotas (modo edición o nuevo plan) */}
            {(!planQuery.data || planEditMode) && (
              <div className="space-y-3">
                {draftInstallments.length === 0 && (
                  <p className="text-xs text-foreground/45 text-center py-2">Sin cuotas definidas. Añade la primera cuota abajo.</p>
                )}
                {draftInstallments.map((inst, idx) => (
                  <div key={idx} className="space-y-1.5 py-1.5 border-b border-foreground/[0.07] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-foreground/40 w-5 shrink-0">#{idx + 1}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Importe (€)"
                        value={inst._amountStr ?? (inst.amountCents > 0 ? (inst.amountCents / 100).toFixed(2) : "")}
                        onChange={(e) => {
                          const val = e.target.value;
                          const cents = Math.round(parseFloat(val.replace(",", ".") || "0") * 100) || 0;
                          const updated = [...draftInstallments];
                          updated[idx] = { ...updated[idx], amountCents: cents, _amountStr: val };
                          if (idx + 1 < updated.length) {
                            const totalCents = Math.round(Number(quote.total ?? 0) * 100);
                            const sumOthers = updated.reduce((s, it, j) => j !== idx + 1 ? s + it.amountCents : s, 0);
                            const remaining = Math.max(0, totalCents - sumOthers);
                            updated[idx + 1] = { ...updated[idx + 1], amountCents: remaining, _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : "" };
                          }
                          setDraftInstallments(updated);
                        }}
                        className="w-20 shrink-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white placeholder:text-foreground/40 focus:outline-none focus:border-violet-500/50"
                      />
                      <input
                        type="date"
                        value={inst.dueDate}
                        onChange={(e) => {
                          const updated = [...draftInstallments];
                          updated[idx] = { ...updated[idx], dueDate: e.target.value };
                          setDraftInstallments(updated);
                        }}
                        className="flex-1 min-w-0 bg-foreground/[0.07] border border-foreground/[0.12] rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                    <div className="flex items-center justify-between pl-7">
                      <label className="flex items-center gap-1.5 text-xs text-violet-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={inst.isRequiredForConfirmation}
                          onChange={(e) => {
                            const updated = [...draftInstallments];
                            updated[idx] = { ...updated[idx], isRequiredForConfirmation: e.target.checked };
                            setDraftInstallments(updated);
                          }}
                          className="accent-violet-500 shrink-0"
                        />
                        Cuota inaplazable
                      </label>
                      <button
                        onClick={() => setDraftInstallments(draftInstallments.filter((_, i) => i !== idx))}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >✕ Eliminar</button>
                    </div>
                  </div>
                ))}

                <button
                  onClick={() => {
                    const totalCents = Math.round(Number(quote.total ?? 0) * 100);
                    const sumExisting = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                    const remaining = Math.max(0, totalCents - sumExisting);
                    setDraftInstallments([...draftInstallments, {
                      installmentNumber: draftInstallments.length + 1,
                      amountCents: remaining,
                      _amountStr: remaining > 0 ? (remaining / 100).toFixed(2) : undefined,
                      dueDate: "",
                      isRequiredForConfirmation: draftInstallments.length === 0,
                      notes: "",
                    }]);
                  }}
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  + Añadir cuota
                </button>

                {draftInstallments.length > 0 && (() => {
                  const sum = draftInstallments.reduce((s, i) => s + i.amountCents, 0);
                  const quoteTotalCents = Math.round(Number(quote.total ?? 0) * 100);
                  const diff = Math.abs(sum - quoteTotalCents);
                  return (
                    <div className={`text-xs px-3 py-1.5 rounded flex justify-between ${diff <= 1 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                      <span>Suma cuotas: {(sum / 100).toFixed(2)} €</span>
                      <span>Total presupuesto: {Number(quote.total ?? 0).toFixed(2)} €</span>
                      {diff > 1 && <span>⚠ Diferencia: {(diff / 100).toFixed(2)} €</span>}
                    </div>
                  );
                })()}

                <Button
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700 text-white text-xs w-full"
                  disabled={draftInstallments.length === 0 || upsertPlan.isPending}
                  onClick={() => {
                    if (draftInstallments.some(i => !i.dueDate || i.amountCents <= 0)) {
                      toast.error("Completa el importe y la fecha de todas las cuotas");
                      return;
                    }
                    upsertPlan.mutate({
                      quoteId,
                      installments: draftInstallments.map((i, idx) => ({ ...i, installmentNumber: idx + 1 })),
                    });
                  }}
                >
                  {upsertPlan.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" />Guardando...</> : "Guardar plan de pago"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      </div>
      <DialogFooter className="flex gap-2 flex-wrap pt-3 pb-4 px-6 border-t border-foreground/[0.12] shrink-0">
        {/* Confirmar Pago — solo para presupuestos SIN plan fraccionado */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && !quote.paymentPlanId && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            onClick={() => setShowConfirmPaymentModal(true)}
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Confirmar Pago
          </Button>
        )}
        {/* Con plan fraccionado: recordar al admin que confirme cuota a cuota */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && !!quote.paymentPlanId && (
          <span className="text-xs text-violet-300/70 italic self-center">
            Plan fraccionado: confirma cada cuota desde el panel ↑
          </span>
        )}
        {/* Enviar / Reenviar */}
        {quote.status === "borrador" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="border-foreground/[0.15] text-foreground/65 text-xs"
              onClick={() => setShowPaymentInput(!showPaymentInput)}
            >
              <ArrowUpRight className="w-3.5 h-3.5 mr-1" /> {showPaymentInput ? "Sin link" : "+ Link pago"}
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              onClick={() => sendQuote.mutate({ id: quoteId, origin: window.location.origin })}
              disabled={sendQuote.isPending}
            >
              {sendQuote.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Enviar al cliente
            </Button>
          </>
        )}
        {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
          <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs" onClick={() => resendQuote.mutate({ id: quoteId, origin: window.location.origin })} disabled={resendQuote.isPending}>
            {resendQuote.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Reenviar
          </Button>
        )}
        {/* Pago Pendiente */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito" || quote.status === "visualizado" || quote.status === "pago_fallido") && (
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs"
            onClick={() => setShowPendingPaymentModal(true)}
          >
            <Clock className="w-3.5 h-3.5 mr-1" />
            Pago Pendiente
          </Button>
        )}
        {/* Plan Fraccionado */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "aceptado") && (
          <Button
            size="sm"
            variant="outline"
            className={`text-xs ${showPlanEditor ? "border-violet-500/60 text-violet-300 bg-violet-500/10" : "border-violet-500/30 text-violet-400 hover:bg-violet-500/10"}`}
            onClick={() => {
              if (!showPlanEditor) {
                setShowPlanEditor(true);
                setPlanEditMode(false);
              } else {
                setShowPlanEditor(false);
                setPlanEditMode(false);
              }
            }}
          >
            <CreditCard className="w-3.5 h-3.5 mr-1" />
            Plan Fraccionado
          </Button>
        )}
        {/* Descargar PDF */}
        <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs" onClick={downloadPdf} disabled={generatePdf.isPending}>
          {generatePdf.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
          Descargar PDF
        </Button>
        {/* Duplicar */}
        <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground text-xs" onClick={() => duplicate.mutate({ id: quoteId })} disabled={duplicate.isPending}>
          <Copy className="w-3.5 h-3.5 mr-1" /> Duplicar
        </Button>
        {/* Marcar perdido */}
        {quote.status !== "aceptado" && quote.status !== "perdido" && (
          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 text-xs" onClick={() => markLost.mutate({ id: quoteId })} disabled={markLost.isPending}>
            <XCircle className="w-3.5 h-3.5 mr-1" /> Perdido
          </Button>
        )}
      </DialogFooter>
    </DialogContent>

      {/* ─── MODAL: Confirmar pago por transferencia bancaria ─── */}
      <Dialog open={showTransferModal} onOpenChange={(o) => {
        setShowTransferModal(o);
        if (!o) { setTransferFile(null); setTransferProofUrl(null); setSelectedBankMovementId(null); setShowBankMovementSearch(false); setBankMovementSearch(""); }
      }}>
        <DialogContent className="max-w-lg bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Banknote className="w-5 h-5 text-blue-400" />
              Confirmar pago por transferencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-foreground/50">
              Puedes confirmar la transferencia manualmente con justificante o vincularla a un movimiento bancario importado para dejarla conciliada.
            </p>

            {/* ── Justificante (opcional si hay movimiento vinculado) ── */}
            <div>
              <div className="text-xs text-foreground/60 font-medium mb-2 uppercase tracking-wide">
                Justificante {selectedBankMovementId ? "(opcional)" : "(obligatorio si no vinculas movimiento)"}
              </div>
              <div className="border-2 border-dashed border-foreground/[0.18] rounded-lg p-4 text-center hover:border-blue-500/50 transition-colors">
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={handleTransferFileChange} className="hidden" id="transfer-proof-input" />
                <label htmlFor="transfer-proof-input" className="cursor-pointer">
                  {isUploadingProof ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                      <span className="text-sm text-foreground/65">Subiendo justificante...</span>
                    </div>
                  ) : transferProofUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle className="w-8 h-8 text-emerald-400" />
                      <span className="text-sm text-emerald-400 font-medium">Justificante adjuntado</span>
                      <span className="text-xs text-foreground/50">{transferFile?.name}</span>
                      <span className="text-xs text-blue-400 underline">Cambiar archivo</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-8 h-8 text-foreground/50" />
                      <span className="text-sm text-foreground/65">Haz clic para adjuntar el justificante</span>
                      <span className="text-xs text-foreground/40">JPG, PNG o PDF · Máx. 10 MB</span>
                    </div>
                  )}
                </label>
              </div>
              {transferProofUrl && (
                <a href={transferProofUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 underline mt-2">
                  <Eye className="w-3.5 h-3.5" /> Ver justificante adjuntado
                </a>
              )}
            </div>

            {/* ── FASE 2A: Vincular movimiento bancario ── */}
            <div className="rounded-lg border border-foreground/[0.12] bg-foreground/[0.03] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-4 h-4 inline-flex items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-bold">2A</span>
                  Vincular movimiento bancario
                </div>
                {!selectedBankMovementId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-blue-400 hover:text-blue-300 text-xs h-7 px-2"
                    onClick={() => setShowBankMovementSearch(!showBankMovementSearch)}
                  >
                    {showBankMovementSearch ? "Ocultar" : "Buscar movimiento"}
                  </Button>
                )}
              </div>

              {selectedBankMovementId ? (
                (() => {
                  const mv = (bankMovementsQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementId)
                    ?? { id: selectedBankMovementId, fecha: "–", movimiento: "Movimiento seleccionado", importe: "–" };
                  return (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle className="w-3.5 h-3.5" /> Movimiento seleccionado
                        </span>
                        <button onClick={() => { setSelectedBankMovementId(null); setShowBankMovementSearch(true); }} className="text-foreground/40 hover:text-foreground/70">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-foreground/70">
                        {mv.fecha} · {mv.movimiento || "–"} · <span className="text-emerald-400 font-semibold">{mv.importe ? `${parseFloat(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</span>
                      </div>
                      {mv.masDatos && <div className="text-foreground/40 truncate">{mv.masDatos}</div>}
                    </div>
                  );
                })()
              ) : (
                <p className="text-xs text-foreground/40">
                  Opcional. Si vinculas un movimiento bancario el sistema registrará la conciliación automáticamente.
                </p>
              )}

              {showBankMovementSearch && !selectedBankMovementId && (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
                    <input
                      className="w-full text-xs bg-foreground/[0.05] border border-foreground/[0.12] rounded-md pl-8 pr-3 py-1.5 text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      placeholder="Buscar por concepto, importe o fecha..."
                      value={bankMovementSearch}
                      onChange={(e) => setBankMovementSearch(e.target.value)}
                    />
                  </div>
                  {bankMovementsQ.isLoading ? (
                    <div className="text-xs text-foreground/40 text-center py-2">
                      <RefreshCw className="w-3 h-3 animate-spin inline mr-1" />Buscando...
                    </div>
                  ) : (bankMovementsQ.data?.data as any[] ?? []).filter((m: any) => parseFloat(m.importe) > 0 && m.conciliationStatus !== "conciliado").length === 0 ? (
                    <p className="text-xs text-foreground/40 text-center py-2">No hay movimientos pendientes disponibles.</p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {(bankMovementsQ.data?.data as any[] ?? [])
                        .filter((m: any) => parseFloat(m.importe) > 0 && m.conciliationStatus !== "conciliado")
                        .map((mv: any) => (
                          <button
                            key={mv.id}
                            onClick={() => { setSelectedBankMovementId(mv.id); setShowBankMovementSearch(false); }}
                            className="w-full text-left rounded-md border border-foreground/[0.08] hover:border-blue-500/40 bg-foreground/[0.04] hover:bg-blue-500/10 p-2 text-xs transition-colors space-y-0.5"
                          >
                            <div className="flex justify-between items-center">
                              <span className="text-foreground/70 font-medium">{mv.fecha}</span>
                              <span className="text-emerald-400 font-semibold">{parseFloat(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</span>
                            </div>
                            <div className="text-foreground/50 truncate">{mv.movimiento || "–"}</div>
                            {mv.masDatos && <div className="text-foreground/30 truncate">{mv.masDatos}</div>}
                          </button>
                        ))
                      }
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="text-foreground/65 hover:text-foreground"
              onClick={() => { setShowTransferModal(false); setTransferFile(null); setTransferProofUrl(null); setSelectedBankMovementId(null); setShowBankMovementSearch(false); setBankMovementSearch(""); }}
            >
              Cancelar
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={(!transferProofUrl && !selectedBankMovementId) || confirmTransfer.isPending}
              onClick={() => confirmTransfer.mutate({ quoteId, bankMovementId: selectedBankMovementId ?? undefined })}
            >
              {confirmTransfer.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Confirmando...</>
              ) : selectedBankMovementId ? (
                <><CheckCircle className="w-4 h-4 mr-2" /> Confirmar y conciliar</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" /> Validar pago y generar factura</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Confirmar pago de cuota individual ─── */}
      <Dialog open={!!confirmingInstallment} onOpenChange={(o) => { if (!o) { setConfirmingInstallment(null); setInstPayMethod("transferencia"); setInstTpvOp(""); setInstPayNote(""); setInstProofUrl(null); setInstProofKey(null); } }}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Confirmar cuota #{confirmingInstallment?.installmentNumber}
            </DialogTitle>
            {confirmingInstallment && (
              <p className="text-foreground/60 text-sm pt-1">
                Importe: <strong className="text-white">{(confirmingInstallment.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</strong>
              </p>
            )}
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta_fisica", "transferencia", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setInstPayMethod(m)}
                  className={`py-2 px-3 rounded-lg border text-xs font-medium transition-colors capitalize ${instPayMethod === m ? "bg-violet-600 border-violet-500 text-white" : "bg-foreground/[0.05] border-foreground/[0.12] text-foreground/60 hover:border-foreground/30"}`}
                >
                  {m === "tarjeta_fisica" ? "Tarjeta Física" : m === "transferencia" ? "Transferencia" : "Efectivo"}
                </button>
              ))}
            </div>
            {instPayMethod === "tarjeta_fisica" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">Nº operación TPV *</Label>
                <Input value={instTpvOp} onChange={(e) => setInstTpvOp(e.target.value)} placeholder="Ej: 12345" className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm" />
              </div>
            )}
            {instPayMethod === "transferencia" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">Justificante de transferencia</Label>
                {!instProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-1 p-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${isUploadingInstProof ? "border-violet-500/40 bg-violet-500/5" : "border-foreground/[0.15] hover:border-foreground/30"}`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" disabled={isUploadingInstProof} onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const allowed = ["image/jpeg", "image/png", "application/pdf"];
                      if (!allowed.includes(file.type)) { toast.error("Solo se permiten JPG, PNG o PDF"); return; }
                      if (file.size > 10 * 1024 * 1024) { toast.error("El archivo no puede superar 10 MB"); return; }
                      setIsUploadingInstProof(true);
                      const reader = new FileReader();
                      reader.onload = async (ev) => {
                        try {
                          const base64 = (ev.target?.result as string).split(",")[1];
                          const result = await uploadProofOnly.mutateAsync({
                            quoteId,
                            fileBase64: base64,
                            fileName: file.name,
                            mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
                          });
                          setInstProofUrl(result.url);
                          setInstProofKey(result.fileKey);
                          toast.success("Justificante subido correctamente");
                        } catch { toast.error("Error al subir el justificante"); }
                        setIsUploadingInstProof(false);
                      };
                      reader.readAsDataURL(file);
                    }} />
                    {isUploadingInstProof ? <><RefreshCw className="w-4 h-4 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">Subiendo...</span></> : <><Upload className="w-4 h-4 text-foreground/50" /><span className="text-xs text-foreground/60">Subir justificante (PDF, JPG, PNG)</span></>}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">Justificante subido</span>
                    <a href={instProofUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Ver</a>
                    <button onClick={() => { setInstProofUrl(null); setInstProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">×</button>
                  </div>
                )}
              </div>
            )}
            {instPayMethod === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">Notas *</Label>
                <Textarea value={instPayNote} onChange={(e) => setInstPayNote(e.target.value)} placeholder="Ej: Cobrado en recepción el 20/04/2026" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65" onClick={() => setConfirmingInstallment(null)}>Cancelar</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={
                confirmInstallmentMut.isPending ||
                (instPayMethod === "tarjeta_fisica" && !instTpvOp.trim()) ||
                (instPayMethod === "efectivo" && !instPayNote.trim())
              }
              onClick={() => {
                if (!confirmingInstallment) return;
                confirmInstallmentMut.mutate({
                  installmentId: confirmingInstallment.id,
                  paymentMethod: instPayMethod,
                  tpvOperationNumber: instPayMethod === "tarjeta_fisica" ? instTpvOp : undefined,
                  transferProofUrl: instPayMethod === "transferencia" ? instProofUrl ?? undefined : undefined,
                  transferProofKey: instPayMethod === "transferencia" ? instProofKey ?? undefined : undefined,
                  paymentNote: instPayMethod === "efectivo" ? instPayNote : undefined,
                });
              }}
            >
              {confirmInstallmentMut.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Confirmando...</> : <><CheckCircle className="w-4 h-4 mr-2" /> Confirmar cuota</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Confirmar Pago (método unificado con campos específicos) ─── */}
      <Dialog open={showConfirmPaymentModal} onOpenChange={(o) => {
        if (!o) { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); }
      }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">Selecciona el método de pago y completa los datos antes de confirmar.</p>
            {/* Selector de método */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button key={m}
                  onClick={() => { setPaymentMethodSelected(m); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setTpvOpSearchForConfirm(""); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    paymentMethodSelected === m ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-foreground/[0.12] bg-foreground/[0.05] text-foreground/60 hover:border-white/25 hover:text-foreground/80"
                  }`}
                >
                  {m === "tarjeta" && <CreditCard className="w-5 h-5" />}
                  {m === "transferencia" && <Banknote className="w-5 h-5" />}
                  {m === "efectivo" && <Receipt className="w-5 h-5" />}
                  {m === "tarjeta" ? "Tarjeta" : m === "transferencia" ? "Transferencia" : "Efectivo"}
                </button>
              ))}
            </div>
            {/* Campo específico por método */}
            {paymentMethodSelected === "tarjeta" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-foreground/70 text-xs">Nº operación TPV {!selectedTpvOpIdForConfirm ? "*" : "(auto)"}</Label>
                  <Input value={viewTpvOp} onChange={(e) => setViewTpvOp(e.target.value)} placeholder="Ej: 000123456789" disabled={!!selectedTpvOpIdForConfirm} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm disabled:opacity-50" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-violet-400" />
                    Vincular operación TPV
                  </div>
                  {!selectedTpvOpIdForConfirm && (
                    <button
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      onClick={() => setShowTpvOpSearchForConfirm(!showTpvOpSearchForConfirm)}
                    >
                      {showTpvOpSearchForConfirm ? "Ocultar" : "Buscar operación"}
                    </button>
                  )}
                </div>
                {selectedTpvOpIdForConfirm ? (
                  (() => {
                    const op = (tpvOpsForConfirmQ.data?.data as any[])?.find((o: any) => o.id === selectedTpvOpIdForConfirm)
                      ?? { id: selectedTpvOpIdForConfirm, operationNumber: viewTpvOp, amount: "–" };
                    return (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-violet-300">Operación TPV vinculada</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setViewTpvOp(""); }}>×</button>
                        </div>
                        <div className="text-foreground/70 font-mono">{op.operationNumber ?? "–"}</div>
                        <div className="text-violet-400 font-medium">{op.amount != null ? `${Number(op.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</div>
                      </div>
                    );
                  })()
                ) : showTpvOpSearchForConfirm ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                      placeholder="Buscar por Nº operación, tarjeta..."
                      value={tpvOpSearchForConfirm}
                      onChange={(e) => setTpvOpSearchForConfirm(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
                      {tpvOpsForConfirmQ.isLoading ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">Buscando...</div>
                      ) : (tpvOpsForConfirmQ.data?.data as any[] | undefined)?.length === 0 ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">No hay operaciones pendientes</div>
                      ) : (
                        (tpvOpsForConfirmQ.data?.data as any[] | undefined)?.map((op: any) => (
                          <button
                            key={op.id}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            onClick={() => { setSelectedTpvOpIdForConfirm(op.id); setViewTpvOp(op.operationNumber ?? ""); setShowTpvOpSearchForConfirm(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono text-white/80">{op.operationNumber}</span>
                              <span className="text-xs text-violet-400 font-medium shrink-0">{Number(op.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</span>
                            </div>
                            <div className="text-xs text-foreground/40 mt-0.5">{op.terminalCode ?? ""} · {new Date(op.operationDatetime).toLocaleDateString("es-ES")}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            {paymentMethodSelected === "transferencia" && (
              <div className="space-y-2">
                <div className="text-xs text-foreground/60 font-medium uppercase tracking-wide">
                  Justificante {selectedBankMovementIdForConfirm ? "(opcional)" : "(obligatorio si no vinculas movimiento)"}
                </div>
                {!viewProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingViewProof ? "border-foreground/[0.18] bg-foreground/[0.05]" : "border-foreground/[0.18] bg-foreground/[0.05] hover:border-emerald-500/50 hover:bg-emerald-500/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleViewProofFileChange} disabled={isUploadingViewProof} />
                    {isUploadingViewProof ? (
                      <><RefreshCw className="w-5 h-5 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">Subiendo...</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-foreground/50" /><span className="text-xs text-foreground/60">Haz clic o arrastra el justificante (PDF, JPG, PNG)</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">Justificante subido correctamente</span>
                    <a href={viewProofUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Ver</a>
                    <button onClick={() => { setViewProofUrl(null); setViewProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">×</button>
                  </div>
                )}

                {/* Bank movement linking block */}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-blue-400" />
                    Vincular movimiento bancario
                  </div>
                  {!selectedBankMovementIdForConfirm && (
                    <button
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      onClick={() => setShowBankMovementSearchForConfirm(!showBankMovementSearchForConfirm)}
                    >
                      {showBankMovementSearchForConfirm ? "Ocultar" : "Buscar movimiento"}
                    </button>
                  )}
                </div>

                {selectedBankMovementIdForConfirm ? (
                  (() => {
                    const mv = (bankMovementsForConfirmQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementIdForConfirm)
                      ?? { id: selectedBankMovementIdForConfirm, fecha: "–", movimiento: "Movimiento seleccionado", importe: "–" };
                    return (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-emerald-300">Movimiento vinculado</span>
                          <button
                            className="text-foreground/40 hover:text-foreground/70 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); }}
                          >×</button>
                        </div>
                        <div className="text-foreground/70 truncate">{mv.movimiento ?? "–"}</div>
                        <div className="flex gap-3 text-foreground/50">
                          <span>{mv.fecha ?? "–"}</span>
                          <span className="text-emerald-400 font-medium">{mv.importe != null ? `${Number(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : showBankMovementSearchForConfirm ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      placeholder="Buscar por concepto, importe o fecha..."
                      value={bankMovementSearchForConfirm}
                      onChange={(e) => setBankMovementSearchForConfirm(e.target.value)}
                    />
                    {bankMovementsForConfirmQ.isLoading ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">Buscando...</div>
                    ) : (bankMovementsForConfirmQ.data?.data as any[] | undefined)?.length === 0 ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">No hay movimientos pendientes</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(bankMovementsForConfirmQ.data?.data as any[] | undefined)?.map((mv: any) => (
                          <button
                            key={mv.id}
                            className="w-full text-left px-2.5 py-2 rounded border border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForConfirm(mv.id); setShowBankMovementSearchForConfirm(false); }}
                          >
                            <div className="text-xs text-white/80 truncate">{mv.movimiento ?? "–"}</div>
                            <div className="flex gap-3 mt-0.5 text-xs text-white/50">
                              <span>{mv.fecha ?? "–"}</span>
                              <span className="text-emerald-400">{mv.importe != null ? `${Number(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {paymentMethodSelected === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">Justificación *</Label>
                <Textarea value={viewPayNote} onChange={(e) => setViewPayNote(e.target.value)} placeholder="Ej: Cobrado en recepción el 31/03/2026" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65 hover:text-foreground" onClick={() => { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); setSelectedBankMovementIdForConfirm(null); setShowBankMovementSearchForConfirm(false); setBankMovementSearchForConfirm(""); setSelectedTpvOpIdForConfirm(null); setShowTpvOpSearchForConfirm(false); setTpvOpSearchForConfirm(""); }}>Cancelar</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={
                confirmPaymentWithMethod.isPending ||
                (paymentMethodSelected === "tarjeta" && !viewTpvOp.trim() && !selectedTpvOpIdForConfirm) ||
                (paymentMethodSelected === "transferencia" && !viewProofUrl && !selectedBankMovementIdForConfirm) ||
                (paymentMethodSelected === "efectivo" && !viewPayNote.trim())
              }
              onClick={() => {
                const payMethod = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "tarjeta_fisica";
                confirmPaymentWithMethod.mutate({
                  quoteId,
                  paymentMethod: payMethod,
                  tpvOperationNumber: paymentMethodSelected === "tarjeta" ? viewTpvOp : undefined,
                  paymentNote: paymentMethodSelected === "efectivo" ? viewPayNote : undefined,
                  transferProofUrl: paymentMethodSelected === "transferencia" ? viewProofUrl ?? undefined : undefined,
                  transferProofKey: paymentMethodSelected === "transferencia" ? viewProofKey ?? undefined : undefined,
                  bankMovementId: paymentMethodSelected === "transferencia" ? selectedBankMovementIdForConfirm ?? undefined : undefined,
                  cardTerminalOperationId: paymentMethodSelected === "tarjeta" ? selectedTpvOpIdForConfirm ?? undefined : undefined,
                });
              }}
            >
              {confirmPaymentWithMethod.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Procesando...</>
              ) : (selectedBankMovementIdForConfirm && paymentMethodSelected === "transferencia") || (selectedTpvOpIdForConfirm && paymentMethodSelected === "tarjeta") ? (
                <><CheckCircle className="w-4 h-4 mr-2" /> Confirmar y conciliar</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" /> Confirmar y generar factura</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Pago Pendiente ─── */}
      <Dialog open={showPendingPaymentModal} onOpenChange={setShowPendingPaymentModal}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" />
              Registrar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">Se creará un registro de pago pendiente y se enviará un email de recordatorio al cliente con la fecha límite.</p>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">Fecha límite de pago *</Label>
              <Input
                type="date"
                value={pendingDueDate}
                onChange={(e) => setPendingDueDate(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">Motivo / nota interna (opcional)</Label>
              <Textarea
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                placeholder="Ej: Cliente confirma pago por transferencia la próxima semana..."
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-foreground/65 hover:text-foreground" onClick={() => setShowPendingPaymentModal(false)}>Cancelar</Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!pendingDueDate || createPendingPayment.isPending}
              onClick={() => {
                if (!data || !pendingDueDate) return;
                createPendingPayment.mutate({
                  quoteId,
                  clientName: data.lead?.name ?? data.quote.title ?? "",
                  clientEmail: data.lead?.email ?? undefined,
                  clientPhone: data.lead?.phone ?? undefined,
                  productName: (data.quote.items as Array<{title?: string; description?: string}>)?.[0]?.title ?? (data.quote.items as Array<{title?: string; description?: string}>)?.[0]?.description ?? data.quote.title ?? "Experiencia",
                  amountCents: Math.round((Number(data.quote.total) || 0) * 100),
                  dueDate: pendingDueDate,
                  reason: pendingReason,
                  origin: window.location.origin,
                });
              }}
            >
              {createPendingPayment.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Registrando...</>
              ) : (
                <><Clock className="w-4 h-4 mr-2" /> Registrar pago pendiente</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── RESERVATION DETAIL MODAL ───────────────────────────────────────────────

function ReservationDetailModal({
  reservationId,
  onClose,
  onEdit,
  onGenerateInvoice,
  onCancel,
}: {
  reservationId: number;
  onClose: () => void;
  onEdit: (id: number, status: string) => void;
  onGenerateInvoice?: (id: number) => void;
  onCancel?: (id: number, name: string) => void;
}) {
  const { data, isLoading } = trpc.crm.reservations.get.useQuery({ id: reservationId });
  const planQuery = trpc.crm.paymentPlans.get.useQuery(
    { quoteId: data?.reservation?.quoteId ?? 0 },
    { enabled: !!data?.reservation?.quoteId }
  );

  const ACTION_LABELS: Record<string, string> = {
    reservation_created:   "Reserva creada",
    reservation_updated:   "Reserva actualizada",
    reservation_paid:      "Reserva pagada online",
    reservation_cancelled: "Reserva cancelada",
    payment_confirmed:     "Pago confirmado",
    transfer_validated:    "Transferencia bancaria validada",
    invoice_generated:     "Factura generada",
    booking_created:       "Actividad programada",
    booking_confirmed:     "Actividad confirmada",
    booking_completed:     "Actividad completada",
    email_sent:            "Email enviado al cliente",
    discount_applied:      "Descuento / bono aplicado",
    email_resent:          "Email de confirmación reenviado",
    date_changed:          "Fecha de reserva modificada",
    status_updated:        "Estado actualizado",
  };
  const translateAction = (action: string) =>
    ACTION_LABELS[action] ?? action.replace(/_/g, " ");

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      paid:            { label: "✅ Confirmada",        cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
      pending_payment: { label: "⏳ Pendiente de pago", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
      cancelled:       { label: "❌ Cancelada",          cls: "bg-red-500/15 text-red-400 border-red-500/30" },
      failed:          { label: "⚠️ Fallida",            cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
      draft:           { label: "📝 Borrador",           cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
      completed:       { label: "🏁 Completada",         cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    };
    const s = map[status] ?? { label: status, cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
    return (
      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
        {s.label}
      </span>
    );
  };

  const getPaymentBadge = (method: string | null) => {
    if (!method) return <span className="text-foreground/30 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      tarjeta_fisica: { label: "Tarjeta Física",  cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      tarjeta_redsys: { label: "Tarjeta Redsys",  cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      redsys:         { label: "Tarjeta Redsys",  cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      tarjeta:        { label: "Tarjeta",          cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      transferencia:  { label: "Transferencia",    cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",         icon: "🏦" },
      efectivo:       { label: "Efectivo",         cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: "💵" },
      otro:           { label: "Otro",             cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "❓" },
    };
    const s = map[method] ?? { label: method, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "" };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
        <span>{s.icon}</span>{s.label}
      </span>
    );
  };

  if (isLoading) {
    return (
      <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }
  if (!data) return null;
  const { reservation: res, invoices: relatedInvoices, activity } = data;
  const amountEur = ((res.amountPaid ?? res.amountTotal) / 100).toFixed(2);
  const totalEur = (res.amountTotal / 100).toFixed(2);

  return (
    <DialogContent className="w-[95vw] max-w-2xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
      <div className="overflow-y-auto flex-1 px-6 pt-6 pb-2">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-700/20 border border-emerald-500/30 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <div className="font-bold">{res.customerName}</div>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {res.reservationNumber && (
                  <span className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
                    {res.reservationNumber}
                  </span>
                )}
                <span className="text-xs text-foreground/40 font-normal font-mono">{res.merchantOrder}</span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Estado, método de pago y canal */}
          {res.cancellationRequestId && (
            <div className="mb-3 flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-2.5">
              <span className="text-orange-400 text-sm">⚠️</span>
              <div>
                <p className="text-orange-400 text-xs font-bold">Solicitud de anulación vinculada</p>
                <p className="text-orange-300/70 text-xs">Expediente #{res.cancellationRequestId}</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {getStatusBadge(res.status)}
            {getPaymentBadge(res.paymentMethod)}
            {planQuery.data && planQuery.data.installments.length > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2.5 py-1 rounded-full">
                <CreditCard className="w-3 h-3" /> Plan de Pagos
              </span>
            )}
            {res.channel === "tpv" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-violet-300 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded-full">
                🖥️ TPV Presencial
              </span>
            )}
            {res.channel === "crm" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-purple-300 bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 rounded-full">
                💼 CRM Delegado
              </span>
            )}
            {(res.channel === "web" || !res.channel) && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-300 bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 rounded-full">
                🌐 Online
              </span>
            )}
            {res.channel === "telefono" && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
                📞 Teléfono
              </span>
            )}
          </div>
          {/* Info de ticket TPV si aplica */}
          {res.channel === "tpv" && res.notes?.includes("[ORIGEN_TPV]") && (
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
              <div className="text-xs font-semibold text-violet-300 mb-1">🖥️ Venta TPV</div>
              <div className="text-xs text-violet-200/70">
                {res.notes.replace("[ORIGEN_TPV] ", "")}
              </div>
            </div>
          )}

          {/* Datos del cliente */}
          <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">Datos del cliente</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-foreground/50 mb-0.5">Nombre</div>
                <div className="text-sm text-white font-medium">{res.customerName}</div>
              </div>
              <div>
                <div className="text-xs text-foreground/50 mb-0.5">Email</div>
                <a href={`mailto:${res.customerEmail}`} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
                  {res.customerEmail}
                </a>
              </div>
              {res.customerPhone && (
                <div>
                  <div className="text-xs text-foreground/50 mb-0.5">Teléfono</div>
                  <a href={`tel:${res.customerPhone}`} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
                    {res.customerPhone}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Detalles de la reserva */}
          <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
            <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">Detalles de la reserva</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Producto</span>
                <span className="text-white font-medium text-right max-w-[60%]">{res.productName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Fecha de actividad</span>
                <span className="text-white font-medium">{res.bookingDate || "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Personas</span>
                <span className="text-white font-medium">{res.people} pax</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Importe total</span>
                <span className="text-orange-400 font-bold">{totalEur} €</span>
              </div>
              {res.amountPaid !== res.amountTotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/60">Importe cobrado</span>
                  <span className="text-emerald-400 font-bold">{amountEur} €</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Referencia</span>
                <span className="font-mono text-foreground/65 text-xs">{res.merchantOrder}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-foreground/60">Creada el</span>
                <span className="text-foreground/65">{new Date(res.createdAt).toLocaleString("es-ES")}</span>
              </div>
              {res.paidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/60">Pagada el</span>
                  <span className="text-emerald-400">{new Date(res.paidAt).toLocaleString("es-ES")}</span>
                </div>
              )}
            </div>
          </div>

          {/* Plan de pago fraccionado */}
          {planQuery.data && planQuery.data.installments.length > 0 && (
            <div className="bg-violet-950/30 border border-violet-500/30 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-semibold text-violet-300 flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-violet-400" />
                  Plan de Pago Fraccionado
                </h4>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  planQuery.data.installments.every(i => i.status === "paid")
                    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                    : planQuery.data.installments.some(i => i.status === "paid")
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    : "bg-violet-500/20 text-violet-300 border-violet-500/30"
                }`}>
                  {planQuery.data.installments.every(i => i.status === "paid")
                    ? "Completado"
                    : planQuery.data.installments.some(i => i.status === "paid")
                    ? "En curso"
                    : "Pendiente"}
                </span>
              </div>
              <div className="space-y-1">
                {planQuery.data.installments.map((inst) => (
                  <div key={inst.id} className="flex items-center justify-between text-xs py-1 border-b border-foreground/[0.06] last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground/40 w-5">#{inst.installmentNumber}</span>
                      <span className={inst.status === "paid" ? "text-emerald-300 font-medium" : "text-foreground/80"}>
                        {(inst.amountCents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                      </span>
                      {inst.isRequiredForConfirmation && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.5 rounded-full">Inaplazable</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {inst.dueDate && <span className="text-foreground/40">{inst.dueDate}</span>}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${
                        inst.status === "paid"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                          : "bg-foreground/[0.06] text-foreground/50 border-foreground/[0.12]"
                      }`}>
                        {inst.status === "paid" ? "Pagada" : "Pendiente"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {(() => {
                const paidTotal = planQuery.data.installments.filter(i => i.status === "paid").reduce((s, i) => s + i.amountCents, 0);
                const pendingTotal = planQuery.data.installments.filter(i => i.status !== "paid").reduce((s, i) => s + i.amountCents, 0);
                return (
                  <div className="flex justify-between pt-1 text-xs text-foreground/60">
                    <span>Cobrado: <span className="text-emerald-300 font-medium">{(paidTotal / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span></span>
                    <span>Pendiente: <span className="text-amber-300 font-medium">{(pendingTotal / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</span></span>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Justificante de transferencia */}
          {res.transferProofUrl && (
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-sky-300 uppercase tracking-wider mb-2">Justificante de transferencia</h4>
              <a
                href={res.transferProofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-sky-400 hover:text-sky-300 transition-colors"
              >
                <Paperclip className="w-4 h-4" />
                Ver justificante adjunto
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* Notas internas */}
          {res.notes && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">Notas internas</h4>
              <p className="text-sm text-foreground/70">{res.notes}</p>
            </div>
          )}

          {/* Líneas del pedido */}
          {(() => {
            const allItems: { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: string }[] = [];
            for (const inv of relatedInvoices) {
              const items = (inv.itemsJson as any[]) ?? [];
              allItems.push(...items);
            }
            if (allItems.length === 0) return null;
            const generalItems = allItems.filter(i => !i.fiscalRegime || i.fiscalRegime !== "reav");
            const reavItems = allItems.filter(i => i.fiscalRegime === "reav");
            return (
              <div className="bg-white/[0.04] border border-foreground/[0.10] rounded-xl p-4">
                <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-3">Líneas del pedido</h4>
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-foreground/40 font-medium pb-1 border-b border-foreground/[0.10]">
                    <div className="col-span-6">Concepto</div>
                    <div className="col-span-2 text-center">Cant.</div>
                    <div className="col-span-2 text-right">P.Unit.</div>
                    <div className="col-span-2 text-right">Total</div>
                  </div>
                  {/* General items */}
                  {generalItems.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-foreground/60 pt-1 pb-0.5">Régimen General (IVA 21%)</div>
                      {generalItems.map((item, i) => (
                        <div key={`g-${i}`} className="grid grid-cols-12 gap-2 text-sm py-1">
                          <div className="col-span-6 text-foreground/80">{item.description}</div>
                          <div className="col-span-2 text-center text-foreground/65">{item.quantity}</div>
                          <div className="col-span-2 text-right text-foreground/65">{Number(item.unitPrice).toFixed(2)} €</div>
                          <div className="col-span-2 text-right text-orange-400 font-medium">{Number(item.total).toFixed(2)} €</div>
                        </div>
                      ))}
                    </>
                  )}
                  {/* REAV items */}
                  {reavItems.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-amber-400/70 pt-1 pb-0.5">REAV — Sin IVA (Régimen Especial Agencias de Viaje)</div>
                      {reavItems.map((item, i) => (
                        <div key={`r-${i}`} className="grid grid-cols-12 gap-2 text-sm py-1">
                          <div className="col-span-6 text-foreground/80 flex items-center gap-1.5">
                            {item.description}
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1 py-0.5 rounded">REAV</span>
                          </div>
                          <div className="col-span-2 text-center text-foreground/65">{item.quantity}</div>
                          <div className="col-span-2 text-right text-foreground/65">{Number(item.unitPrice).toFixed(2)} €</div>
                          <div className="col-span-2 text-right text-orange-400 font-medium">{Number(item.total).toFixed(2)} €</div>
                        </div>
                      ))}
                    </>
                  )}
                  {/* Totals */}
                  <div className="border-t border-foreground/[0.10] pt-2 mt-1 space-y-1">
                    {generalItems.length > 0 && reavItems.length > 0 && (
                      <div className="flex justify-between text-xs text-foreground/50">
                        <span>Subtotal rég. general</span>
                        <span>{generalItems.reduce((s, i) => s + Number(i.total), 0).toFixed(2)} €</span>
                      </div>
                    )}
                    {reavItems.length > 0 && (
                      <div className="flex justify-between text-xs text-amber-400/60">
                        <span>Subtotal REAV (sin IVA)</span>
                        <span>{reavItems.reduce((s, i) => s + Number(i.total), 0).toFixed(2)} €</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-foreground">
                      <span>Total</span>
                      <span className="text-orange-400">{allItems.reduce((s, i) => s + Number(i.total), 0).toFixed(2)} €</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Facturas asociadas */}
          {relatedInvoices.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Facturas asociadas</h4>
              <div className="space-y-2">
                {relatedInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between bg-foreground/[0.05] border border-foreground/[0.10] rounded-xl px-4 py-3">
                    <div>
                      <div className="text-sm font-mono font-bold text-foreground">{inv.invoiceNumber}</div>
                      <div className="text-xs text-foreground/50 mt-0.5">
                        {new Date(inv.createdAt).toLocaleDateString("es-ES")} · {inv.status}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-orange-400">{Number(inv.total).toFixed(2)} €</span>
                      {inv.pdfUrl && (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                        >
                          <FileDown className="w-3.5 h-3.5" /> PDF
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Historial de actividad */}
          {activity.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-foreground/50 uppercase tracking-wider mb-2">Historial de actividad</h4>
              <div className="space-y-1.5">
                {activity.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b border-foreground/[0.08] last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground/70">{translateAction(log.action)}</div>
                      {log.actorName && (
                        <div className="text-xs text-foreground/40">{log.actorName}</div>
                      )}
                    </div>
                    <div className="text-xs text-foreground/40 shrink-0">
                      {new Date(log.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="px-6 py-4 border-t border-foreground/[0.10] flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-foreground/[0.15] text-foreground/65">
          Cerrar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          onClick={() => { onClose(); onEdit(res.id, res.status); }}
        >
          <Pencil className="w-4 h-4 mr-1" /> Editar reserva
        </Button>
        {relatedInvoices.length === 0 && onGenerateInvoice && (
          <Button
            size="sm"
            className="bg-sky-600 hover:bg-sky-700 text-white"
            onClick={() => { onClose(); onGenerateInvoice(res.id); }}
          >
            <FilePlus className="w-4 h-4 mr-1" /> Generar factura
          </Button>
        )}
        {relatedInvoices[0]?.pdfUrl && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => window.open(relatedInvoices[0].pdfUrl ?? undefined, "_blank")}
          >
            <FileDown className="w-4 h-4 mr-1" /> Descargar factura PDF
          </Button>
        )}
        {/* Anular reserva — solo si no está ya cancelada y no tiene expediente activo */}
        {onCancel && res.status !== "cancelled" && !res.cancellationRequestId && (
          <Button
            size="sm"
            variant="outline"
            className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10 ml-auto"
            onClick={() => { onClose(); onCancel(res.id, res.customerName); }}
          >
            <XCircle className="w-4 h-4 mr-1" /> Anular reserva
          </Button>
        )}
        {res.cancellationRequestId && (
          <span className="ml-auto text-xs text-orange-400/70 border border-orange-500/20 rounded px-2 py-1">
            ⚠️ Expediente #{res.cancellationRequestId} activo
          </span>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ─── MAIN CRM DASHBOARD ───────────────────────────────────────────────────────

export default function CRMDashboard() {
  // Sincronizar tab con ?tab= de la URL (reactivo al navegar desde el sidebar)
  const searchStr = useSearch();
  const tabFromSearch = (s: string): Tab => {
    try {
      const t = new URLSearchParams(s).get("tab");
      if (t === "leads" || t === "quotes" || t === "reservations" || t === "invoices" || t === "anulaciones" || t === "pagos_pendientes" || t === "bonos") return t;
    } catch { /* ignore */ }
    return "leads";
  };
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(searchStr));
  const [search, setSearch] = useState(() => {
    try { return new URLSearchParams(searchStr).get("search") ?? ""; } catch { return ""; }
  });
  const [filterStatus, setFilterStatus] = useState<string>("all");
  // Cuando el usuario navega via sidebar (?tab= cambia), sincronizar el estado interno
  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    setTab(tabFromSearch(searchStr));
    setSearch(params.get("search") ?? "");
    setFilterStatus("all");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchStr]);
  const [kpisExpanded, setKpisExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem("crm_kpis_expanded") !== "false"; } catch { return true; }
  });
  const toggleKpis = () => setKpisExpanded(prev => {
    const next = !prev;
    try { localStorage.setItem("crm_kpis_expanded", String(next)); } catch {}
    return next;
  });
  // Selección masiva
  const [selectedLeads, setSelectedLeads] = useState<Set<number>>(new Set());
  const [selectedQuotes, setSelectedQuotes] = useState<Set<number>>(new Set());
  const [selectedRes, setSelectedRes] = useState<Set<number>>(new Set());
  const [bulkLeadsStatus, setBulkLeadsStatus] = useState("");
  const [bulkQuotesStatus, setBulkQuotesStatus] = useState("");
  const [bulkResStatus, setBulkResStatus] = useState("");

  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [editLeadId, setEditLeadId] = useState<number | null>(null);
  const [deleteLeadId, setDeleteLeadId] = useState<number | null>(null);
  const [convertLeadId, setConvertLeadId] = useState<number | null>(null);
  const [convertLeadName, setConvertLeadName] = useState<string>("");
  const [selectedQuoteId, setSelectedQuoteId] = useState<number | null>(null);
  const [editQuoteId, setEditQuoteId] = useState<number | null>(null);
  const [deleteQuoteId, setDeleteQuoteId] = useState<number | null>(null);
  const [sendQuoteId, setSendQuoteId] = useState<number | null>(null);
  const [confirmPaymentId, setConfirmPaymentId] = useState<number | null>(null);
  const [confirmPayMethodRow, setConfirmPayMethodRow] = useState<"tarjeta" | "transferencia" | "efectivo">("tarjeta");
  const [confirmPayTpvOp, setConfirmPayTpvOp] = useState("");
  const [confirmPayNote, setConfirmPayNote] = useState("");
  const [confirmPayRowProofUrl, setConfirmPayRowProofUrl] = useState<string | null>(null);
  const [confirmPayRowProofKey, setConfirmPayRowProofKey] = useState<string | null>(null);
  const [isUploadingRowProof, setIsUploadingRowProof] = useState(false);
  const [selectedBankMovementIdForRow, setSelectedBankMovementIdForRow] = useState<number | null>(null);
  const [showBankMovementSearchForRow, setShowBankMovementSearchForRow] = useState(false);
  const [bankMovementSearchForRow, setBankMovementSearchForRow] = useState("");
  // TPV op linking (row confirm payment modal)
  const [selectedTpvOpIdForRow, setSelectedTpvOpIdForRow] = useState<number | null>(null);
  const [showTpvOpSearchForRow, setShowTpvOpSearchForRow] = useState(false);
  const [tpvOpSearchForRow, setTpvOpSearchForRow] = useState("");
  const [convertReservationId, setConvertReservationId] = useState<number | null>(null);
  // Estado para el modal de pago pendiente desde fila (icono 5)
  const [rowPendingPayQuoteId, setRowPendingPayQuoteId] = useState<number | null>(null);
  const [rowPendingPayDueDate, setRowPendingPayDueDate] = useState("");
  const [rowPendingPayReason, setRowPendingPayReason] = useState("");
  const [markLostQuoteId, setMarkLostQuoteId] = useState<number | null>(null);
  const [showDirectQuoteModal, setShowDirectQuoteModal] = useState(false);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showNewReservationModal, setShowNewReservationModal] = useState(false);
  // ─── Estado dropdown acciones reservas ────────────────────────────────────────────────────
  const [resChannelFilter, setResChannelFilter] = useState<string>("all");
  const [resActionMenuId, setResActionMenuId] = useState<number | null>(null);
  const [viewResId, setViewResId] = useState<number | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const id = p.get("resId");
      return id ? parseInt(id, 10) : null;
    } catch { return null; }
  });
  const [editResId, setEditResId] = useState<number | null>(null);
  const [editResData, setEditResData] = useState<any>(null);
  const [deleteResId, setDeleteResId] = useState<number | null>(null);
  const [editResStatus, setEditResStatus] = useState<string>("");
  const [editResNotes, setEditResNotes] = useState<string>("");
  const [editResStatusReservation, setEditResStatusReservation] = useState<string>("");
  const [editResStatusPayment, setEditResStatusPayment] = useState<string>("");
  const [editResChannel, setEditResChannel] = useState<string>("");
  const [editResChannelDetail, setEditResChannelDetail] = useState<string>("");
  const [editResNewDate, setEditResNewDate] = useState<string>("");
  const [editResDateReason, setEditResDateReason] = useState<string>("");
  const [showChangeDateSection, setShowChangeDateSection] = useState(false);
  const { data: leadCounters } = trpc.crm.leads.counters.useQuery();
  const { data: quoteCounters } = trpc.crm.quotes.counters.useQuery();
  const { data: resCounters } = trpc.crm.reservations.counters.useQuery();
  const { data: upcomingInstallments } = trpc.crm.paymentPlans.upcoming.useQuery({ daysAhead: 7 });

  const PAGE_SIZE = 50;
  const [leadsPage, setLeadsPage] = useState(0);
  const [quotesPage, setQuotesPage] = useState(0);
  const [resPage, setResPage] = useState(0);

  // Resetear página al cambiar filtros o búsqueda
  useEffect(() => { setLeadsPage(0); }, [filterStatus, search]);
  useEffect(() => { setQuotesPage(0); }, [filterStatus, search]);
  useEffect(() => { setResPage(0); }, [filterStatus, resChannelFilter, search]);

  const leadsFilter = useMemo(() => ({
    opportunityStatus: filterStatus !== "all" && tab === "leads" ? (filterStatus as OpportunityStatus) : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: leadsPage * PAGE_SIZE,
  }), [filterStatus, search, tab, leadsPage]);

  const quotesFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "quotes" ? (filterStatus as QuoteStatus) : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: quotesPage * PAGE_SIZE,
  }), [filterStatus, search, tab, quotesPage]);

  const resFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "reservations" ? filterStatus : undefined,
    channel: resChannelFilter !== "all" ? resChannelFilter : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: resPage * PAGE_SIZE,
  }), [filterStatus, resChannelFilter, search, tab, resPage]);

  const { data: leadsData, isLoading: leadsLoading } = trpc.crm.leads.list.useQuery(leadsFilter, { enabled: tab === "leads" });
  const { data: quotesData, isLoading: quotesLoading } = trpc.crm.quotes.list.useQuery(quotesFilter, { enabled: tab === "quotes" });
  const { data: resData, isLoading: resLoading } = trpc.crm.reservations.list.useQuery(resFilter, { enabled: tab === "reservations" });

  // ─── FACTURAS ────────────────────────────────────────────────────────────────────────────────
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<"all" | "generada" | "enviada" | "cobrada" | "anulada" | "abonada">("all");
  const [invoiceDateFrom, setInvoiceDateFrom] = useState("");
  const [invoiceDateTo, setInvoiceDateTo] = useState("");
  const [invoiceTypeFilter, setInvoiceTypeFilter] = useState<"all" | "factura" | "abono">("all");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [confirmPaymentInvoiceId, setConfirmPaymentInvoiceId] = useState<number | null>(null);
  const [creditNoteInvoiceId, setCreditNoteInvoiceId] = useState<number | null>(null);
  const [voidInvoiceId, setVoidInvoiceId] = useState<number | null>(null);
  const [deleteInvoiceId, setDeleteInvoiceId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"transferencia" | "efectivo" | "otro">("transferencia");
  const [creditNoteReason, setCreditNoteReason] = useState("");

  const invoiceFilter = useMemo(() => ({
    status: invoiceStatusFilter !== "all" ? invoiceStatusFilter as "generada" | "enviada" | "cobrada" | "anulada" | "abonada" : undefined,
    invoiceType: invoiceTypeFilter !== "all" ? invoiceTypeFilter as "factura" | "abono" : undefined,
    search: invoiceSearch || undefined,
    dateFrom: invoiceDateFrom || undefined,
    dateTo: invoiceDateTo || undefined,
    limit: 50,
    offset: 0,
  }), [invoiceStatusFilter, invoiceTypeFilter, invoiceSearch, invoiceDateFrom, invoiceDateTo]);

  const { data: invoicesData, isLoading: invoicesLoading, refetch: refetchInvoices } = trpc.crm.invoices.listAll.useQuery(
    invoiceFilter,
    { enabled: tab === "invoices" }
  );
  // ─── Anular Reserva directa ──────────────────────────────────────────────────
  const [cancelReservationId, setCancelReservationId] = useState<number | null>(null);
  const [cancelReservationName, setCancelReservationName] = useState<string>("");
  // requestId del expediente recién creado → abre CancellationDetailModal en modo auto-aceptar
  const [cancelAutoAcceptAnulId, setCancelAutoAcceptAnulId] = useState<number | null>(null);

  // ─── Anulaciones state ───────────────────────────────────────────────────────
  const [anulSearch, setAnulSearch] = useState("");
  const [anulOpFilter, setAnulOpFilter] = useState("all");
  const [anulResFilter, setAnulResFilter] = useState("all");
  const [anulFinFilter, setAnulFinFilter] = useState("all");
  const [anulReasonFilter, setAnulReasonFilter] = useState("all");
  const [selectedAnulId, setSelectedAnulId] = useState<number | null>(null);
  const [deleteAnulId, setDeleteAnulId] = useState<number | null>(null);
  const { data: anulData, isLoading: anulLoading, isError: anulError, refetch: refetchAnul } = trpc.cancellations.listRequests.useQuery({
    search: anulSearch || undefined,
    operationalStatus: anulOpFilter !== "all" ? anulOpFilter : undefined,
    resolutionStatus: anulResFilter !== "all" ? anulResFilter : undefined,
    financialStatus: anulFinFilter !== "all" ? anulFinFilter : undefined,
    reason: anulReasonFilter !== "all" ? anulReasonFilter : undefined,
    limit: 100,
    offset: 0,
  }, { enabled: tab === "anulaciones", retry: 1 });
  const { data: anulCounters } = trpc.cancellations.getCounters.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: voucherCounters } = trpc.cancellations.getVoucherCounters.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: auditData } = trpc.crm.reservations.auditOrphans.useQuery(undefined, {
    refetchInterval: 120000,
  });
  const { data: tpvPaymentAlerts } = trpc.cardTerminalBatches.getCrmPaymentAlerts.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: expenseStats } = trpc.bankMovements.getExpenseStats.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const deleteAnulMutation = trpc.cancellations.deleteRequest.useMutation({
    onSuccess: () => {
      toast.success("Solicitud eliminada");
      setDeleteAnulId(null);
      utils.cancellations.listRequests.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const anulRows = anulData?.rows ?? [];
  const anulKpis = anulData?.kpis;

  const utils = trpc.useUtils();

  // ─── Acciones masivas ─────────────────────────────────────────────────────────
  const bulkDeleteLeads = trpc.crm.leads.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(`${r.deleted} lead(s) eliminados`); setSelectedLeads(new Set()); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkMarkSeenLeads = trpc.crm.leads.bulkMarkSeen.useMutation({
    onSuccess: (r) => { toast.success(`${r.updated} lead(s) marcados como leídos`); setSelectedLeads(new Set()); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateLeadsStatus = trpc.crm.leads.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(`Estado actualizado en ${r.updated} lead(s)`); setSelectedLeads(new Set()); setBulkLeadsStatus(""); utils.crm.leads.list.invalidate(); utils.crm.leads.counters.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkDeleteQuotes = trpc.crm.quotes.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(`${r.deleted} presupuesto(s) eliminados`); setSelectedQuotes(new Set()); utils.crm.quotes.list.invalidate(); utils.crm.quotes.counters.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateQuotesStatus = trpc.crm.quotes.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(`Estado actualizado en ${r.updated} presupuesto(s)`); setSelectedQuotes(new Set()); setBulkQuotesStatus(""); utils.crm.quotes.list.invalidate(); utils.crm.quotes.counters.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkDeleteRes = trpc.crm.reservations.bulkDelete.useMutation({
    onSuccess: (r) => { toast.success(`${r.deleted} reserva(s) eliminadas${r.skipped > 0 ? ` (${r.skipped} omitidas por estar pagadas)` : ""}`); setSelectedRes(new Set()); utils.crm.reservations.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const bulkUpdateResStatus = trpc.crm.reservations.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { toast.success(`Estado actualizado en ${r.updated} reserva(s)`); setSelectedRes(new Set()); setBulkResStatus(""); utils.crm.reservations.list.invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteLead = trpc.crm.leads.delete.useMutation({
    onSuccess: () => {
      toast.success("Lead eliminado");
      setDeleteLeadId(null);
      utils.crm.leads.list.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteQuote = trpc.crm.quotes.delete.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto eliminado");
      setDeleteQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendQuoteMutation = trpc.crm.quotes.send.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto enviado al cliente");
      setSendQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendQuoteMutation = trpc.crm.quotes.resend.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto reenviado al cliente");
      utils.crm.quotes.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Queries para Modal 2 (CRMDashboard scope)
  const bankMovementsForRowQ = trpc.bankMovements.listMovements.useQuery(
    { status: "pendiente", search: bankMovementSearchForRow || undefined, pageSize: 20, page: 1 },
    { enabled: showBankMovementSearchForRow && confirmPaymentId !== null && confirmPayMethodRow === "transferencia" }
  );
  const tpvOpsForRowQ = trpc.cardTerminalOperations.list.useQuery(
    { status: "pendiente", search: tpvOpSearchForRow || undefined, pageSize: 20, page: 1 },
    { enabled: showTpvOpSearchForRow && confirmPaymentId !== null && confirmPayMethodRow === "tarjeta" }
  );

  const confirmPaymentMutation = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: () => {
      toast.success("Pago confirmado — reserva y factura generadas");
      setConfirmPaymentId(null);
      setSelectedBankMovementIdForRow(null);
      setShowBankMovementSearchForRow(false);
      setBankMovementSearchForRow("");
      setSelectedTpvOpIdForRow(null);
      setShowTpvOpSearchForRow(false);
      setTpvOpSearchForRow("");
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
      utils.bankMovements.listMovements.invalidate();
      utils.cardTerminalOperations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const uploadProofOnlyRow = trpc.crm.quotes.uploadProofOnly.useMutation({
    onError: (e) => toast.error(`Error al subir el justificante: ${e.message}`),
  });

  const handleRowProofFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) { toast.error("Solo se permiten archivos JPG, PNG o PDF"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("El archivo no puede superar 10 MB"); return; }
    setIsUploadingRowProof(true);
    try {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(",")[1];
        const result = await uploadProofOnlyRow.mutateAsync({
          quoteId: confirmPaymentId!,
          fileBase64: base64,
          fileName: file.name,
          mimeType: file.type as "image/jpeg" | "image/png" | "application/pdf",
        });
        setConfirmPayRowProofUrl(result.url);
        setConfirmPayRowProofKey(result.fileKey);
        setIsUploadingRowProof(false);
        toast.success("Justificante subido correctamente");
      };
      reader.readAsDataURL(file);
    } catch (_) {
      setIsUploadingRowProof(false);
    }
  };

  const convertReservationMutation = trpc.crm.quotes.convertToReservation.useMutation({
    onSuccess: () => {
      toast.success("Convertido a reserva (pendiente de cobro)");
      setConvertReservationId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Mutación de pago pendiente desde fila (icono 5 — mismo flujo que el botón del modal)
  const rowPendingPayMutation = trpc.crm.pendingPayments.create.useMutation({
    onSuccess: () => {
      toast.success("Pago pendiente registrado · Reserva creada · Email enviado al cliente");
      setRowPendingPayQuoteId(null);
      setRowPendingPayDueDate("");
      setRowPendingPayReason("");
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const markLostQuoteMutation = trpc.crm.quotes.markLost.useMutation({
    onSuccess: () => {
      toast.success("Presupuesto marcado como perdido");
      setMarkLostQuoteId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const duplicateQuoteMutation = trpc.crm.quotes.duplicate.useMutation({
    onSuccess: (data) => {
      toast.success(`Presupuesto duplicado: ${data.quoteNumber}`);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const generatePdfMutation = trpc.crm.quotes.generatePdf.useMutation({
    onError: (e) => toast.error(e.message),
  });

  // ─── MUTACIONES DE RESERVAS ───────────────────────────────────────────────
  const updateResMutation = trpc.crm.reservations.update.useMutation({
    onSuccess: () => {
      toast.success("Reserva actualizada");
      setEditResId(null);
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendResMutation = trpc.crm.reservations.resendConfirmation.useMutation({
    onSuccess: (data) => toast.success(`Email reenviado a ${data.sentTo}`),
    onError: (e) => toast.error(e.message),
  });

  const deleteResMutation = trpc.crm.reservations.delete.useMutation({
    onSuccess: () => {
      toast.success("Reserva eliminada");
      setDeleteResId(null);
      utils.crm.reservations.list.invalidate();
      utils.crm.reservations.counters.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatusesMutation = trpc.crm.reservations.updateStatuses.useMutation({
    onSuccess: () => {
      toast.success("Estados actualizados");
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const changeDateMutation = trpc.crm.reservations.changeDate.useMutation({
    onSuccess: () => {
      toast.success("Fecha de actividad actualizada");
      setShowChangeDateSection(false);
      setEditResNewDate("");
      setEditResDateReason("");
      utils.crm.reservations.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const downloadResPdfMutation = trpc.crm.reservations.downloadPdf.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("PDF generado correctamente");
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── Generar factura desde reserva TPV ─────────────────────────────────────
  const [genInvoiceResId, setGenInvoiceResId] = useState<number | null>(null);
  const [genInvoiceNif, setGenInvoiceNif] = useState("");
  const [genInvoiceAddress, setGenInvoiceAddress] = useState("");
  const generateInvoiceMutation = trpc.crm.reservations.generateInvoice.useMutation({
    onSuccess: (data) => {
      toast.success(`✅ Factura ${data.invoiceNumber} generada correctamente`);
      setGenInvoiceResId(null);
      setGenInvoiceNif("");
      setGenInvoiceAddress("");
      utils.crm.reservations.list.invalidate();
      utils.crm.invoices.listAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const downloadQuotePdf = async (quoteId: number, quoteNumber: string) => {
    const toastId = toast.loading(`Generando PDF ${quoteNumber}...`);
    try {
      const result = await generatePdfMutation.mutateAsync({ id: quoteId });
      // Open the S3 URL directly in a new tab for download
      const a = document.createElement("a");
      a.href = result.pdfUrl;
      a.download = result.filename;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("PDF generado correctamente", { id: toastId });
    } catch {
      toast.error("Error al generar el PDF", { id: toastId });
    }
  };

  // ─── MUTACIONES DE FACTURAS ────────────────────────────────────────────────────────────────────────────────
  const confirmManualPaymentMutation = trpc.crm.invoices.confirmManualPayment.useMutation({
    onSuccess: () => {
      toast.success("✅ Pago confirmado manualmente");
      setConfirmPaymentInvoiceId(null);
      utils.crm.invoices.listAll.invalidate();
      utils.crm.reservations.list.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(e.message),
  });

  const createCreditNoteMutation = trpc.crm.invoices.createCreditNote.useMutation({
    onSuccess: (data) => {
      toast.success(`Abono ${data.creditNoteNumber} generado correctamente`);
      setCreditNoteInvoiceId(null);
      setCreditNoteReason("");
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendInvoiceMutation = trpc.crm.invoices.resend.useMutation({
    onSuccess: (data) => {
      toast.success(`Factura reenviada a ${data.sentTo}`);
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(e.message),
  });

  const voidInvoiceMutation = trpc.crm.invoices.void.useMutation({
    onSuccess: () => {
      toast.success("Factura anulada");
      setVoidInvoiceId(null);
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteInvoiceMutation = trpc.crm.invoices.delete.useMutation({
    onSuccess: () => {
      toast.success("Factura eliminada — reserva desvinculada");
      setDeleteInvoiceId(null);
      utils.crm.invoices.listAll.invalidate();
      refetchInvoices();
    },
    onError: (e) => toast.error(e.message),
  });

  const regenerateInvoicePdfMutation = trpc.crm.invoices.regeneratePdf.useMutation({
    onSuccess: () => {
      refetchInvoices();
      utils.crm.invoices.listAll.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const viewInvoicePdf = (invoice: any) => {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, "_blank");
    } else {
      toast.error("No hay PDF disponible para esta factura");
    }
  };

  const downloadInvoicePdf = async (invoice: any) => {
    if (!invoice.pdfUrl) { toast.error("No hay PDF disponible para esta factura"); return; }
    try {
      const res = await fetch(invoice.pdfUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoiceNumber ?? "factura"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(invoice.pdfUrl, "_blank");
    }
  };

  const getInvoiceStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      generada: { label: "Generada", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
      enviada: { label: "Enviada", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
      cobrada: { label: "Cobrada", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
      anulada: { label: "Anulada", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
      abonada: { label: "Abonada", cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
    };
    const s = map[status] ?? { label: status, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.12]" };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
  };

  const getPaymentMethodLabel = (method: string | null) => {
    if (!method) return null;
    const map: Record<string, string> = {
      tarjeta_fisica: "💳 Tarjeta Física",
      tarjeta_redsys: "💳 Tarjeta Redsys",
      redsys:         "💳 Tarjeta Redsys",
      tarjeta:        "💳 Tarjeta",
      transferencia:  "🏦 Transferencia",
      efectivo:       "💵 Efectivo",
      otro:           "❓ Otro",
    };
    return map[method] ?? method;
  };

  const getPaymentMethodBadge = (method: string | null) => {
    if (!method) return <span className="text-foreground/30 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      tarjeta_fisica: { label: "Tarjeta Física", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      tarjeta_redsys: { label: "Tarjeta Redsys", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      redsys:         { label: "Tarjeta Redsys", cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      tarjeta:        { label: "Tarjeta",        cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      transferencia:  { label: "Transferencia",  cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",         icon: "🏦" },
      efectivo:       { label: "Efectivo",       cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: "💵" },
      otro:           { label: "Otro",           cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "❓" },
    };
    const s = map[method] ?? { label: method, cls: "bg-foreground/[0.08] text-foreground/60 border-foreground/[0.15]", icon: "" };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
        <span>{s.icon}</span>
        {s.label}
      </span>
    );
  };

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setFilterStatus("all");
    setSearch("");
  };

  return (
    <AdminLayout title="CRM Comercial">
      <div className="min-h-screen bg-background text-foreground dark:bg-[#080e1c]">
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">CRM Comercial</h1>
              <p className="text-xs sm:text-sm text-foreground/50 mt-0.5 hidden sm:block">Pipeline completo Lead → Presupuesto → Reserva → Factura</p>
            </div>
          </div>
        </div>

        {/* ── Alertas de pagos fraccionados urgentes ── */}
        {(() => {
          const todayStr = new Date().toISOString().split("T")[0];
          const overdue = (upcomingInstallments ?? []).filter(i =>
            i.status === "overdue" || (i.status === "pending" && i.dueDate < todayStr)
          );
          const dueToday = (upcomingInstallments ?? []).filter(i =>
            i.status === "pending" && i.dueDate === todayStr
          );
          if (overdue.length === 0 && dueToday.length === 0) return null;
          return (
            <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/8 p-3 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> Incidencias de pagos fraccionados
              </p>
              {overdue.length > 0 && (
                <p className="text-sm text-red-300">
                  <strong>{overdue.length}</strong> cuota{overdue.length > 1 ? "s" : ""} vencida{overdue.length > 1 ? "s" : ""} sin cobrar
                  {" — "}{overdue.map(i => i.quoteNumber).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                </p>
              )}
              {dueToday.length > 0 && (
                <p className="text-sm text-amber-300">
                  <strong>{dueToday.length}</strong> cuota{dueToday.length > 1 ? "s" : ""} vence hoy
                  {" — "}{dueToday.map(i => i.quoteNumber).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                </p>
              )}
            </div>
          );
        })()}

        {/* ── KPI PANEL COLAPSABLE ─────────────────────────────────────────── */}
        <div className="px-4 sm:px-6 pb-1">
          {/* Cabecera toggle — siempre visible */}
          <button
            onClick={toggleKpis}
            className="w-full flex items-center gap-3 py-2.5 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] hover:bg-foreground/[0.06] transition-colors group"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap gap-y-1">
              {/* Pills resumen cuando está colapsado */}
              {!kpisExpanded && (
                <>
                  {(leadCounters?.ganada ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-300 text-[11px] font-medium">
                      <Star className="w-2.5 h-2.5" />{leadCounters?.ganada} ganadas
                    </span>
                  )}
                  {(leadCounters?.enviada ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium">
                      <Send className="w-2.5 h-2.5" />{leadCounters?.enviada} enviadas
                    </span>
                  )}
                  {(resCounters?.confirmadas ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] font-medium">
                      <CheckCircle className="w-2.5 h-2.5" />{resCounters?.confirmadas} reservas
                      {(resCounters?.importeConfirmadas ?? 0) > 0 && <span className="opacity-60">· {Math.round(resCounters!.importeConfirmadas).toLocaleString("es-ES")} €</span>}
                    </span>
                  )}
                  {(resCounters?.pendientePago ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] font-medium">
                      <Clock className="w-2.5 h-2.5" />{resCounters?.pendientePago} pend. pago
                    </span>
                  )}
                  {(anulCounters?.pending ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] font-medium">
                      <AlertTriangle className="w-2.5 h-2.5" />{anulCounters?.pending} anulaciones
                    </span>
                  )}
                </>
              )}
              {kpisExpanded && (
                <span className="text-xs text-foreground/40 font-medium">Panel de indicadores</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-foreground/40 group-hover:text-foreground/70 transition-colors flex-shrink-0">
              <span className="text-[11px]">{kpisExpanded ? "Ocultar" : "Ver KPIs"}</span>
              {kpisExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
        </div>

        {/* Top KPI strip — dos grupos diferenciados */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${kpisExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">

          {/* Grupo 1: Pipeline de Oportunidades */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-blue-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Pipeline de Oportunidades</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(leadCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-foreground/40">{leadCounters?.total ?? 0} leads totales</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="Nueva Oportunidad"
                value={leadCounters?.nueva ?? 0}
                icon={Users}
                color="blue"
                subtitle="Leads sin gestionar"
                amount={leadCounters?.valorNueva}
                active={tab === "leads" && filterStatus === "nueva"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("nueva"); }}
              />
              <CounterCard
                label="Oportunidad Enviada"
                value={leadCounters?.enviada ?? 0}
                icon={Send}
                color="blue"
                subtitle="Presupuesto en cliente"
                amount={leadCounters?.valorEnviada}
                active={tab === "leads" && filterStatus === "enviada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("enviada"); }}
              />
              <CounterCard
                label="Oportunidad Ganada"
                value={leadCounters?.ganada ?? 0}
                icon={Star}
                color="blue"
                subtitle="Reservas confirmadas"
                amount={leadCounters?.valorGanada}
                active={tab === "leads" && filterStatus === "ganada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("ganada"); }}
              />
              <CounterCard
                label="Oportunidad Perdida"
                value={leadCounters?.perdida ?? 0}
                icon={XCircle}
                color="blue"
                subtitle="Descartadas manualmente"
                amount={leadCounters?.valorPerdida}
                active={tab === "leads" && filterStatus === "perdida"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("perdida"); }}
              />
            </div>
          </div>

          {/* Grupo 2: Presupuestos & Ingresos */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-orange-400 to-orange-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Presupuestos &amp; Ingresos</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="En Borrador"
                value={quoteCounters?.borrador ?? 0}
                icon={FileText}
                color="orange"
                subtitle="Pendientes de enviar"
                amount={quoteCounters?.importeBorrador}
                active={tab === "quotes" && filterStatus === "borrador"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("borrador"); }}
              />
              <CounterCard
                label="Enviados al Cliente"
                value={quoteCounters?.enviado ?? 0}
                icon={Clock}
                color="orange"
                subtitle="Esperando respuesta"
                amount={quoteCounters?.importeEnviado}
                active={tab === "quotes" && filterStatus === "enviado"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("enviado"); }}
              />
              {(quoteCounters?.pagoFallido ?? 0) > 0 && (
                <CounterCard
                  label="Pago Fallido"
                  value={quoteCounters?.pagoFallido ?? 0}
                  icon={XCircle}
                  color="orange"
                  subtitle="Recuperables"
                  amount={quoteCounters?.importePagoFallido}
                  active={tab === "quotes" && filterStatus === "pago_fallido"}
                  onClick={() => { handleTabChange("quotes"); setFilterStatus("pago_fallido"); }}
                />
              )}
              <CounterCard
                label="Reservas Hoy"
                value={resCounters?.hoy ?? 0}
                icon={CalendarCheck}
                color="orange"
                subtitle="Confirmadas hoy"
                amount={resCounters?.importeServicioHoy}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label="Ingresos Totales"
                value={`${Number(resCounters?.ingresos ?? 0).toFixed(0)} €`}
                icon={Banknote}
                color="orange"
                subtitle="Reservas pagadas"
                onClick={() => handleTabChange("reservations")}
              />
            </div>
          </div>
          {/* Grupo 2b: Reservas */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-green-400 to-green-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Reservas</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(resCounters?.confirmadas ?? 0) > 0 && (
                <span className="text-xs text-foreground/40">{resCounters?.confirmadas ?? 0} confirmadas</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="Confirmadas"
                value={resCounters?.confirmadas ?? 0}
                icon={CheckCircle}
                color="green"
                subtitle="Reservas pagadas"
                amount={resCounters?.importeConfirmadas}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label="Pendiente de Pago"
                value={resCounters?.pendientePago ?? 0}
                icon={Clock}
                color="green"
                subtitle="Esperando cobro"
                amount={resCounters?.importePendientePago}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label="Servicio Hoy"
                value={resCounters?.servicioHoy ?? 0}
                icon={CalendarCheck}
                color="green"
                subtitle="Actividades programadas"
                amount={resCounters?.importeServicioHoy}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label="Próximos 7 días"
                value={resCounters?.proximasSemana ?? 0}
                icon={Calendar}
                color="green"
                subtitle="Servicios confirmados"
                amount={resCounters?.importeProximasSemana}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label="Este Mes"
                value={resCounters?.esteMes ?? 0}
                icon={Banknote}
                color="green"
                subtitle="Confirmadas este mes"
                amount={resCounters?.importeEsteMes}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              {(resCounters?.canceladas ?? 0) > 0 && (
                <CounterCard
                  label="Canceladas"
                  value={resCounters?.canceladas ?? 0}
                  icon={XCircle}
                  color="green"
                  subtitle="Reservas anuladas"
                  active={tab === "reservations"}
                  onClick={() => handleTabChange("reservations")}
                />
              )}
            </div>
          </div>

          {/* Grupo 3: Anulaciones */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-red-400 to-red-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Anulaciones</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(anulCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-foreground/40">{anulCounters?.total ?? 0} totales</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <CounterCard
                label="Pendientes"
                value={anulCounters?.pending ?? 0}
                icon={AlertTriangle}
                color="red"
                subtitle="Sin resolver"
                amount={anulCounters?.importePendiente}
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label="Incidencias"
                value={anulCounters?.incidencias ?? 0}
                icon={AlertCircle}
                color="red"
                subtitle="Requieren atención"
                amount={anulCounters?.importeIncidencias}
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label="Total"
                value={anulCounters?.total ?? 0}
                icon={Archive}
                color="red"
                subtitle="Todas las solicitudes"
                amount={anulCounters?.importeTotal}
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
            </div>
          </div>

          {/* Grupo 5: Próximos Pagos Fraccionados */}
          {upcomingInstallments && upcomingInstallments.length > 0 && (() => {
            const today = new Date().toISOString().split("T")[0];
            const vencenHoy = upcomingInstallments.filter(i => i.dueDate === today);
            const enDeuda = upcomingInstallments.filter(i => i.status === "overdue" || (i.status === "pending" && i.dueDate < today));
            const totalPendienteCents = upcomingInstallments
              .filter(i => i.status !== "paid" && i.status !== "cancelled")
              .reduce((s, i) => s + i.amountCents, 0);
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded-full bg-gradient-to-b from-violet-400 to-violet-600" />
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Próximos Pagos Fraccionados</span>
                  <div className="flex-1 h-px bg-foreground/[0.05]" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <CounterCard
                    label="Vencen en 7 días"
                    value={upcomingInstallments.filter(i => i.status === "pending" && i.dueDate >= today).length}
                    icon={CreditCard}
                    color="violet"
                    subtitle="Cuotas pendientes"
                    amount={upcomingInstallments.filter(i => i.status === "pending" && i.dueDate >= today).reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label="Vencen Hoy"
                    value={vencenHoy.length}
                    icon={AlertCircle}
                    color={vencenHoy.length > 0 ? "amber" : "slate"}
                    subtitle="Requieren cobro"
                    amount={vencenHoy.reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label="En Deuda"
                    value={enDeuda.length}
                    icon={AlertTriangle}
                    color={enDeuda.length > 0 ? "red" : "slate"}
                    subtitle="Vencidas sin pagar"
                    amount={enDeuda.reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label="Total Pendiente"
                    value={`${(totalPendienteCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 0 })} €`}
                    icon={Banknote}
                    color="violet"
                    subtitle="Suma cuotas activas"
                  />
                </div>
                {/* Mini-tabla de cuotas próximas */}
                <div className="mt-3 bg-foreground/[0.03] border border-foreground/[0.07] rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                        <th className="text-left px-3 py-2 text-foreground/45 font-medium">Presupuesto</th>
                        <th className="text-left px-3 py-2 text-foreground/45 font-medium">Cuota</th>
                        <th className="text-right px-3 py-2 text-foreground/45 font-medium">Importe</th>
                        <th className="text-center px-3 py-2 text-foreground/45 font-medium">Vencimiento</th>
                        <th className="text-center px-3 py-2 text-foreground/45 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingInstallments.slice(0, 8).map((inst) => {
                        const isOverdue = inst.status === "overdue" || (inst.status === "pending" && inst.dueDate < today);
                        const isToday = inst.dueDate === today;
                        return (
                          <tr key={inst.id} className="border-b border-foreground/[0.06] last:border-0 hover:bg-foreground/[0.03]">
                            <td className="px-3 py-2 text-foreground/70">{inst.quoteNumber}</td>
                            <td className="px-3 py-2 text-foreground/55">#{inst.installmentNumber}</td>
                            <td className="px-3 py-2 text-right font-semibold text-white">{(inst.amountCents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</td>
                            <td className="px-3 py-2 text-center text-foreground/55">{inst.dueDate}</td>
                            <td className="px-3 py-2 text-center">
                              {isOverdue ? (
                                <span className="bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded">Vencida</span>
                              ) : isToday ? (
                                <span className="bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded">Hoy</span>
                              ) : (
                                <span className="bg-violet-500/15 text-violet-300 border border-violet-500/25 px-1.5 py-0.5 rounded">Pendiente</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* Grupo 4: Bonos compensatorios */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-purple-400 to-purple-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Bonos compensatorios</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <CounterCard
                label="Activos"
                value={voucherCounters?.activos ?? 0}
                icon={Gift}
                color="purple"
                subtitle="Pendientes de canjear"
                amount={voucherCounters?.importePendiente}
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
              <CounterCard
                label="Canjeados"
                value={voucherCounters?.canjeados ?? 0}
                icon={CheckCircle}
                color="purple"
                subtitle="Usados por clientes"
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
              <CounterCard
                label="Caducados"
                value={voucherCounters?.caducados ?? 0}
                icon={Clock}
                color="purple"
                subtitle="Sin canjear a tiempo"
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
            </div>
          </div>
        </div>

        {/* Barra de ratio de conversión */}
        {(leadCounters?.total ?? 0) > 0 && (
          <div className="px-6 pb-4">
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">Ratio de Conversión</span>
                  {(leadCounters?.sinLeer ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-blue-400 font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                      </span>
                      {leadCounters?.sinLeer ?? 0} sin leer
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-foreground/50">
                  <span className="text-emerald-400 font-bold text-sm">
                    {leadCounters?.total ? Math.round(((leadCounters.ganada ?? 0) / leadCounters.total) * 100) : 0}%
                  </span>
                  <span>{leadCounters?.ganada ?? 0} ganadas de {leadCounters?.total ?? 0} leads</span>
                </div>
              </div>
              {/* Barra segmentada */}
              <div className="relative h-3 bg-foreground/[0.05] rounded-full overflow-hidden">
                {/* Ganadas */}
                <div
                  className="absolute left-0 top-0 h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-1000"
                  style={{ width: `${leadCounters?.total ? ((leadCounters.ganada ?? 0) / leadCounters.total) * 100 : 0}%` }}
                />
                {/* Enviadas (apiladas) */}
                <div
                  className="absolute top-0 h-full bg-gradient-to-r from-amber-500/60 to-amber-400/60 rounded-full transition-all duration-1000"
                  style={{
                    left: `${leadCounters?.total ? ((leadCounters.ganada ?? 0) / leadCounters.total) * 100 : 0}%`,
                    width: `${leadCounters?.total ? ((leadCounters.enviada ?? 0) / leadCounters.total) * 100 : 0}%`,
                  }}
                />
                {/* Nuevas (apiladas) */}
                <div
                  className="absolute top-0 h-full bg-gradient-to-r from-blue-500/40 to-blue-400/40 rounded-full transition-all duration-1000"
                  style={{
                    left: `${leadCounters?.total ? (((leadCounters.ganada ?? 0) + (leadCounters.enviada ?? 0)) / leadCounters.total) * 100 : 0}%`,
                    width: `${leadCounters?.total ? ((leadCounters.nueva ?? 0) / leadCounters.total) * 100 : 0}%`,
                  }}
                />
              </div>
              {/* Leyenda */}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  Ganadas ({leadCounters?.ganada ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  Enviadas ({leadCounters?.enviada ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500/40" />
                  Nuevas ({leadCounters?.nueva ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                  Perdidas ({leadCounters?.perdida ?? 0})
                </div>
              </div>
            </div>
          </div>
        )}
        </div>{/* /KPI colapsable */}

        {/* ── Banner auditoría reservas sin factura / sin REAV ─────────────── */}
        {auditData && (auditData.sinFacturaCount > 0 || auditData.sinReavCount > 0) && (
          <div className="mx-6 mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              Auditoría — se detectaron incidencias en reservas pagadas
            </div>
            {auditData.sinFacturaCount > 0 && (
              <div>
                <p className="text-xs text-amber-300/80 font-medium mb-1">
                  {auditData.sinFacturaCount} reserva{auditData.sinFacturaCount !== 1 ? "s" : ""} pagada{auditData.sinFacturaCount !== 1 ? "s" : ""} sin factura asociada:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {auditData.sinFactura.map(r => (
                    <button
                      key={r.id}
                      onClick={() => setGenInvoiceResId(r.id)}
                      className="inline-flex items-center gap-1.5 text-[11px] bg-amber-900/40 hover:bg-amber-800/60 text-amber-200 rounded px-2 py-1 transition-colors cursor-pointer"
                      title="Generar factura para esta reserva"
                    >
                      <span className="font-mono font-bold">{r.reservationNumber ?? `#${r.id}`}</span>
                      <span className="text-amber-300/60">·</span>
                      <span>{r.customerName}</span>
                      {r.amountEur > 0 && <span className="text-amber-300/70">{fmtAmount(r.amountEur)}</span>}
                      <FilePlus className="w-3 h-3 text-amber-400 ml-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {auditData.sinReavCount > 0 && (
              <div>
                <p className="text-xs text-amber-300/80 font-medium mb-1">
                  {auditData.sinReavCount} reserva{auditData.sinReavCount !== 1 ? "s" : ""} REAV sin expediente (revisar en Fiscal REAV):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {auditData.sinReav.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { handleTabChange("reservations"); setViewResId(r.id); }}
                      className="inline-flex items-center gap-1.5 text-[11px] bg-amber-900/40 hover:bg-amber-800/60 text-amber-200 rounded px-2 py-1 transition-colors cursor-pointer"
                      title="Ver reserva"
                    >
                      <span className="font-mono font-bold">{r.reservationNumber ?? `#${r.id}`}</span>
                      <span className="text-amber-300/60">·</span>
                      <span>{r.customerName}</span>
                      <ExternalLink className="w-3 h-3 text-amber-400 ml-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Banner alertas TPV / coherencia cobros + gastos ─────────────── */}
        {((tpvPaymentAlerts && (tpvPaymentAlerts.unlinkedTpvOps > 0 || tpvPaymentAlerts.staleFailedPayments > 0)) ||
          (expenseStats && (expenseStats.candidatesCount > 0 || expenseStats.staleExpensesCount > 0))) && (
          <div className="mx-4 sm:mx-6 mb-2 rounded-xl border border-blue-500/30 bg-blue-500/8 px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-blue-400 font-semibold text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              Coherencia financiera — incidencias detectadas
            </div>
            {(tpvPaymentAlerts?.unlinkedTpvOps ?? 0) > 0 && (
              <a href="/admin/contabilidad/operaciones-tpv" className="text-xs text-blue-300/80 hover:text-blue-200 transition-colors">
                • {tpvPaymentAlerts!.unlinkedTpvOps} operación{tpvPaymentAlerts!.unlinkedTpvOps !== 1 ? "es" : ""} TPV sin vincular a reserva/factura → Operaciones TPV
              </a>
            )}
            {(tpvPaymentAlerts?.staleFailedPayments ?? 0) > 0 && (
              <span className="text-xs text-amber-300/80">
                • {tpvPaymentAlerts!.staleFailedPayments} presupuesto{tpvPaymentAlerts!.staleFailedPayments !== 1 ? "s" : ""} con pago fallido sin resolver +48h
              </span>
            )}
            {(expenseStats?.candidatesCount ?? 0) > 0 && (
              <a href="/admin/contabilidad/gastos" className="text-xs text-violet-300/80 hover:text-violet-200 transition-colors">
                • {expenseStats!.candidatesCount} cargo{expenseStats!.candidatesCount !== 1 ? "s" : ""} bancario{expenseStats!.candidatesCount !== 1 ? "s" : ""} sin registrar como gasto → Gastos
              </a>
            )}
            {(expenseStats?.staleExpensesCount ?? 0) > 0 && (
              <a href="/admin/contabilidad/gastos" className="text-xs text-yellow-300/80 hover:text-yellow-200 transition-colors">
                • {expenseStats!.staleExpensesCount} gasto{expenseStats!.staleExpensesCount !== 1 ? "s" : ""} pendiente{expenseStats!.staleExpensesCount !== 1 ? "s" : ""} sin justificar +30 días → Gastos
              </a>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="px-4 sm:px-6">
          <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="flex gap-1 bg-foreground/[0.05] rounded-xl p-1 min-w-max">
            {([
              { key: "leads", label: "Leads", icon: Users, count: leadCounters?.total },
              { key: "quotes", label: "Presupuestos", icon: FileText, count: quoteCounters?.enviado },
              { key: "reservations", label: "Reservas", icon: CalendarCheck, count: resCounters?.confirmadas },
              { key: "invoices", label: "Facturas", icon: Receipt, count: undefined },
              { key: "anulaciones", label: "Anulaciones", icon: AlertTriangle, count: anulCounters?.pending },
              { key: "bonos", label: "Bonos", icon: Gift, count: undefined },
              { key: "pagos_pendientes", label: "Pagos Pendientes", icon: Clock, count: undefined },
            ] as const).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${tab === key ? "bg-orange-600 text-white shadow-lg shadow-orange-900/30" : "text-foreground/60 hover:text-foreground hover:bg-foreground/[0.05]"}`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === key ? "bg-foreground/[0.15] text-white" : "bg-foreground/[0.08] text-foreground/65"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
          </div>
        </div>

        {/* Search & filter */}
        {tab !== "anulaciones" && tab !== "bonos" && (
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${tab === "leads" ? "leads" : tab === "quotes" ? "presupuestos" : tab === "reservations" ? "reservas" : "facturas"}...`}
              className="pl-9 bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40"
            />
          </div>
          {filterStatus !== "all" && (
            <Button size="sm" variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10 text-xs" onClick={() => setFilterStatus("all")}>
              <Filter className="w-3.5 h-3.5 mr-1" /> Limpiar filtro
            </Button>
          )}
          {/* Filtro por canal — visible solo en el tab de reservas */}
          {tab === "reservations" && (
            <Select value={resChannelFilter} onValueChange={setResChannelFilter}>
              <SelectTrigger className="w-full sm:w-40 bg-foreground/[0.05] border-foreground/[0.12] text-white text-xs h-9">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1520] border-foreground/[0.12]">
                <SelectItem value="all" className="text-foreground/70 text-xs">📊 Todos los canales</SelectItem>
                <SelectItem value="tpv" className="text-violet-300 text-xs">🖥️ TPV Presencial</SelectItem>
                <SelectItem value="web" className="text-sky-300 text-xs">🌐 Online</SelectItem>
                <SelectItem value="crm" className="text-purple-300 text-xs">💼 CRM Delegado</SelectItem>
                <SelectItem value="telefono" className="text-amber-300 text-xs">📞 Teléfono</SelectItem>
                <SelectItem value="coupon" className="text-orange-300 text-xs">🎫 Plataformas (Cupón)</SelectItem>
                <SelectItem value="otro" className="text-foreground/60 text-xs">❓ Otro</SelectItem>
              </SelectContent>
            </Select>
          )}
          {/* Botones de creación manual — visibles según el tab activo */}
          {tab === "leads" && (
            <Button
              size="sm"
              onClick={() => setShowNewLeadModal(true)}
              className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo Lead
            </Button>
          )}
          {tab === "reservations" && (
            <Button
              size="sm"
              onClick={() => setShowNewReservationModal(true)}
              className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nueva Reserva
            </Button>
          )}
          {tab === "quotes" && (
            <Button
              size="sm"
              onClick={() => setShowDirectQuoteModal(true)}
              className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo Presupuesto
            </Button>
          )}
        </div>
        )}

        {/* Table */}
        <div className="px-4 sm:px-6 pb-8">
          {tab === "leads" && (
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
            {/* Barra acción masiva leads */}
            {selectedLeads.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20">
                <span className="text-xs text-blue-300 font-medium shrink-0">{selectedLeads.size} seleccionado(s)</span>
                <button onClick={() => bulkMarkSeenLeads.mutate({ ids: Array.from(selectedLeads) })} disabled={bulkMarkSeenLeads.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-foreground/20 hover:bg-foreground/10 transition-colors disabled:opacity-40">
                  <Eye className="w-3.5 h-3.5" /> Marcar leídos
                </button>
                <select value={bulkLeadsStatus} onChange={e => { if (e.target.value) bulkUpdateLeadsStatus.mutate({ ids: Array.from(selectedLeads), status: e.target.value as any }); }} disabled={bulkUpdateLeadsStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">Cambiar estado…</option>
                  <option value="nueva">Nueva</option>
                  <option value="enviada">Enviada</option>
                  <option value="ganada">Ganada</option>
                  <option value="perdida">Perdida</option>
                </select>
                <button onClick={() => { if (confirm(`¿Eliminar ${selectedLeads.size} lead(s) definitivamente?`)) bulkDeleteLeads.mutate({ ids: Array.from(selectedLeads) }); }} disabled={bulkDeleteLeads.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
                <button onClick={() => setSelectedLeads(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!leadsData?.rows?.length && selectedLeads.size === leadsData.rows.length} onChange={e => setSelectedLeads(e.target.checked ? new Set(leadsData?.rows?.map((l: any) => l.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">Recibido</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell">Fecha actividad</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !leadsData?.rows?.length ? (
                    <tr><td colSpan={7} className="text-center py-12 text-foreground/40 text-sm">No hay leads {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : leadsData.rows.map((lead: any) => (
                    <tr key={lead.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${selectedLeads.has(lead.id) ? "bg-blue-500/5" : !lead.seenAt ? "bg-blue-950/20" : ""}`}>
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedLeads.has(lead.id)} onChange={e => setSelectedLeads(prev => { const s = new Set(prev); e.target.checked ? s.add(lead.id) : s.delete(lead.id); return s; })} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-foreground/70 font-medium">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</div>
                        <div className="text-[11px] text-foreground/40">{new Date(lead.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {/* Punto pulse para leads no leídos */}
                          {!lead.seenAt ? (
                            <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                            </span>
                          ) : (
                            <PriorityDot priority={lead.priority as Priority} />
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              {(lead as typeof lead & { clientId?: number }).clientId ? (
                                <a
                                  href={`/admin/crm/clientes?clientId=${(lead as typeof lead & { clientId?: number }).clientId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-sm font-medium text-foreground hover:text-blue-300 hover:underline transition-colors"
                                >{lead.name}</a>
                              ) : (
                                <span className="text-sm font-medium text-foreground">{lead.name}</span>
                              )}
                              {!lead.seenAt && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Nuevo</span>}
                            </div>
                            <div className="text-xs text-foreground/50">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {(lead.activitiesJson as any[]).slice(0, 2).map((act: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="text-sm text-foreground/80">{act.experienceTitle}</span>
                                <span className="text-xs text-orange-400 font-semibold">{act.participants}p</span>
                              </div>
                            ))}
                            {(lead.activitiesJson as any[]).length > 2 && (
                              <span className="text-xs text-foreground/40">+{(lead.activitiesJson as any[]).length - 2} más</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-foreground/65">{lead.selectedProduct || lead.selectedCategory || "—"}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-sm text-foreground/60">{lead.preferredDate ? new Date(lead.preferredDate).toLocaleDateString("es-ES") : "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
                          {(lead as any).source === "venta_perdida" && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25 w-fit">
                              Abandonada
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-foreground/60 hover:text-foreground h-7 px-2 text-xs"
                            onClick={() => setSelectedLeadId(lead.id)}
                            title="Ver ficha"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-400 hover:text-blue-300 h-7 px-2 text-xs"
                            onClick={() => setEditLeadId(lead.id)}
                            title="Editar lead"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <ProposalLeadButton leadId={lead.id} leadName={lead.name} />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-orange-400 hover:text-orange-300 h-7 px-2 text-xs"
                            onClick={() => { setConvertLeadId(lead.id); setConvertLeadName(lead.name); }}
                            title="Crear presupuesto"
                          >
                            <FileText className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 hover:text-red-300 h-7 px-2 text-xs"
                            onClick={() => setDeleteLeadId(lead.id)}
                            title="Eliminar lead"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {leadsData && leadsData.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  Página {leadsPage + 1} de {Math.ceil(leadsData.total / PAGE_SIZE)} · {leadsData.total} leads
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLeadsPage(p => p - 1)}
                    disabled={leadsPage === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >← Anterior</button>
                  <button
                    onClick={() => setLeadsPage(p => p + 1)}
                    disabled={(leadsPage + 1) * PAGE_SIZE >= leadsData.total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >Siguiente →</button>
                </div>
              </div>
            )}
            </div>
          )}

          {tab === "quotes" && (
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
            {/* Barra acción masiva quotes */}
            {selectedQuotes.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20">
                <span className="text-xs text-blue-300 font-medium shrink-0">{selectedQuotes.size} seleccionado(s)</span>
                <select value={bulkQuotesStatus} onChange={e => { if (e.target.value) bulkUpdateQuotesStatus.mutate({ ids: Array.from(selectedQuotes), status: e.target.value as any }); }} disabled={bulkUpdateQuotesStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">Cambiar estado…</option>
                  <option value="borrador">Borrador</option>
                  <option value="enviado">Enviado</option>
                  <option value="aceptado">Aceptado</option>
                  <option value="rechazado">Rechazado</option>
                  <option value="perdido">Perdido</option>
                  <option value="expirado">Expirado</option>
                </select>
                <button onClick={() => { if (confirm(`¿Eliminar ${selectedQuotes.size} presupuesto(s) definitivamente?`)) bulkDeleteQuotes.mutate({ ids: Array.from(selectedQuotes) }); }} disabled={bulkDeleteQuotes.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
                <button onClick={() => setSelectedQuotes(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!quotesData?.rows?.length && selectedQuotes.size === quotesData.rows.length} onChange={e => setSelectedQuotes(e.target.checked ? new Set(quotesData?.rows?.map((q: any) => q.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Referencia</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">Título</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Total</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">Fecha</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {quotesLoading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !quotesData?.rows?.length ? (
                    <tr><td colSpan={8} className="text-center py-12 text-foreground/40 text-sm">No hay presupuestos {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : quotesData.rows.map((quote: any) => (
                    <tr key={quote.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors group ${selectedQuotes.has(quote.id) ? "bg-blue-500/5" : ""}`}>
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedQuotes.has(quote.id)} onChange={e => setSelectedQuotes(prev => { const s = new Set(prev); e.target.checked ? s.add(quote.id) : s.delete(quote.id); return s; })} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-mono font-medium text-orange-400">{quote.quoteNumber}</div>
                        <div className="text-[10px] text-foreground/40 mt-0.5">{new Date(quote.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      <td className="px-4 py-3">
                        {(quote as typeof quote & { clientId?: number }).clientId ? (
                          <a
                            href={`/admin/crm/clientes?clientId=${(quote as typeof quote & { clientId?: number }).clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-foreground/90 hover:text-blue-300 hover:underline transition-colors block"
                          >{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</a>
                        ) : (
                          <div className="text-sm font-medium text-foreground/90">{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</div>
                        )}
                        <div className="text-[10px] text-foreground/50 truncate max-w-[140px]">{(quote as typeof quote & { clientEmail?: string }).clientEmail ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-foreground/70 truncate max-w-[180px]">{quote.title}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <QuoteStatusBadge status={quote.status as QuoteStatus} />
                          {quote.status === "aceptado" && !quote.paidAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                              Pendiente cobro
                            </span>
                          )}
                          {quote.paidAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                              <CheckCircle className="w-2.5 h-2.5" />
                              Cobrado
                            </span>
                          )}
                          {quote.isAutoGenerated && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded-full"
                              title="Generado automáticamente desde las actividades del lead"
                            >
                              <Sparkles className="w-2.5 h-2.5" />
                              Auto-IA
                            </span>
                          )}
                          {quote.viewedAt && !quote.paidAt && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded-full"
                              title={`Visto por el cliente el ${new Date(quote.viewedAt).toLocaleString("es-ES")}`}
                            >
                              <Eye className="w-2.5 h-2.5" />
                              Visto {new Date(quote.viewedAt).toLocaleDateString("es-ES")}
                            </span>
                          )}
                          {quote.sentAt && !quote.viewedAt && !quote.paidAt &&
                            quote.status !== "pago_fallido" && quote.status !== "convertido_carrito" && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-foreground/40 bg-foreground/[0.05] border border-foreground/[0.12] px-1.5 py-0.5 rounded-full">
                              <Eye className="w-2.5 h-2.5" />
                              No visto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-foreground">{Number(quote.total).toFixed(2)} €</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-foreground/50">
                          {quote.sentAt ? (
                            <span className="text-blue-400/70">Env. {new Date(quote.sentAt).toLocaleDateString("es-ES")}</span>
                          ) : (
                            new Date(quote.createdAt).toLocaleDateString("es-ES")
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Ver */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground h-7 w-7 p-0" onClick={() => setSelectedQuoteId(quote.id)} title="Ver detalle">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-blue-300 h-7 w-7 p-0" onClick={() => setEditQuoteId(quote.id)} title="Editar">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {/* Enviar al cliente (solo borrador) */}
                          {(quote.status === "borrador") && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-orange-300 h-7 w-7 p-0" onClick={() => setSendQuoteId(quote.id)} title="Enviar al cliente">
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Reenviar (usa resend para no resetear el status) */}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-blue-300 h-7 w-7 p-0"
                              onClick={() => resendQuoteMutation.mutate({ id: quote.id, origin: window.location.origin })} title="Reenviar al cliente">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Confirmar pago — solo sin plan fraccionado; con plan, hacerlo cuota a cuota desde el detalle */}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido" || (quote.status === "aceptado" && !quote.paidAt)) && !quote.paymentPlanId && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-emerald-300 h-7 w-7 p-0" onClick={() => setConfirmPaymentId(quote.id)} title="Confirmar pago recibido">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && !!quote.paymentPlanId && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-violet-300 h-7 w-7 p-0" onClick={() => setSelectedQuoteId(quote.id)} title="Plan fraccionado — confirma cuotas en el detalle">
                              <CalendarDays className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Convertir a reserva pendiente de cobro */}
                          {(quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
                            <Button
                              size="sm" variant="ghost"
                              className="text-foreground/50 hover:text-amber-300 h-7 w-7 p-0"
                              onClick={() => {
                                setRowPendingPayQuoteId(quote.id);
                                setRowPendingPayDueDate("");
                                setRowPendingPayReason("");
                              }}
                              title="Convertir a reserva pendiente de cobro"
                            >
                              <Clock className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Marcar perdido */}
                          {(quote.status === "borrador" || quote.status === "enviado" || quote.status === "visualizado" || quote.status === "convertido_carrito" || quote.status === "pago_fallido") && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-red-300 h-7 w-7 p-0" onClick={() => setMarkLostQuoteId(quote.id)} title="Marcar como perdido">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Descargar PDF */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-amber-300 h-7 w-7 p-0"
                            onClick={() => downloadQuotePdf(quote.id, quote.quoteNumber)} title="Descargar presupuesto en PDF"
                            disabled={generatePdfMutation.isPending}>
                            <FileDown className="w-3.5 h-3.5" />
                          </Button>
                          {/* Duplicar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-foreground/70 h-7 w-7 p-0"
                            onClick={() => duplicateQuoteMutation.mutate({ id: quote.id })} title="Duplicar presupuesto">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {/* Eliminar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-red-400 h-7 w-7 p-0" onClick={() => setDeleteQuoteId(quote.id)} title="Eliminar">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {quotesData && quotesData.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  Página {quotesPage + 1} de {Math.ceil(quotesData.total / PAGE_SIZE)} · {quotesData.total} presupuestos
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setQuotesPage(p => p - 1)}
                    disabled={quotesPage === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >← Anterior</button>
                  <button
                    onClick={() => setQuotesPage(p => p + 1)}
                    disabled={(quotesPage + 1) * PAGE_SIZE >= quotesData.total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >Siguiente →</button>
                </div>
              </div>
            )}
            </div>
          )}

          {tab === "reservations" && (
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
            {/* Barra acción masiva reservas */}
            {selectedRes.size > 0 && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20">
                <span className="text-xs text-blue-300 font-medium shrink-0">{selectedRes.size} seleccionado(s)</span>
                <select value={bulkResStatus} onChange={e => { if (e.target.value) bulkUpdateResStatus.mutate({ ids: Array.from(selectedRes), status: e.target.value as any }); }} disabled={bulkUpdateResStatus.isPending} className="px-2 py-1 text-xs rounded-md border border-foreground/20 bg-background disabled:opacity-40">
                  <option value="">Cambiar estado…</option>
                  <option value="paid">Pagada</option>
                  <option value="pending_payment">Pendiente pago</option>
                  <option value="cancelled">Cancelada</option>
                </select>
                <button onClick={() => { if (confirm(`¿Eliminar ${selectedRes.size} reserva(s)? Las reservas pagadas serán omitidas.`)) bulkDeleteRes.mutate({ ids: Array.from(selectedRes) }); }} disabled={bulkDeleteRes.isPending} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  <Trash2 className="w-3.5 h-3.5" /> Eliminar
                </button>
                <button onClick={() => setSelectedRes(new Set())} className="ml-auto text-foreground/40 hover:text-foreground/70 p-1"><X className="w-4 h-4" /></button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={!!resData?.rows?.length && selectedRes.size === resData.rows.length} onChange={e => setSelectedRes(e.target.checked ? new Set(resData?.rows?.map((r: any) => r.id)) : new Set())} />
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Nº Reserva</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Est. Reserva</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Est. Pago</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden xl:table-cell">Canal</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell">F. Compra</th>
                    <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden lg:table-cell">F. Actividad</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Importe</th>
                    <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resLoading ? (
                    <tr><td colSpan={11} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !resData?.rows?.length ? (
                    <tr><td colSpan={11} className="text-center py-12 text-foreground/40 text-sm">No hay reservas</td></tr>
                  ) : resData.rows.map((res: any) => (
                    <tr key={res.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${selectedRes.has(res.id) ? "bg-blue-500/5" : ""}`}>
                      {/* Checkbox */}
                      <td className="w-10 px-3 py-3">
                        <input type="checkbox" className="rounded border-foreground/30 bg-background cursor-pointer" checked={selectedRes.has(res.id)} onChange={e => setSelectedRes(prev => { const s = new Set(prev); e.target.checked ? s.add(res.id) : s.delete(res.id); return s; })} />
                      </td>
                      {/* Nº Reserva */}
                      <td className="px-4 py-3 shrink-0">
                        {res.reservationNumber ? (
                          <span className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-2 py-0.5 whitespace-nowrap">
                            {res.reservationNumber}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-foreground/30">—</span>
                        )}
                      </td>
                      {/* Cliente */}
                      <td className="px-4 py-3">
                        {(res as typeof res & { clientId?: number }).clientId ? (
                          <a
                            href={`/admin/crm/clientes?clientId=${(res as typeof res & { clientId?: number }).clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm font-medium text-foreground hover:text-blue-300 hover:underline transition-colors block"
                          >{res.customerName}</a>
                        ) : (
                          <div className="text-sm font-medium text-foreground">{res.customerName}</div>
                        )}
                        <div className="text-xs text-foreground/50">{res.customerEmail}</div>
                        {res.customerPhone && <div className="text-xs text-foreground/40 mt-0.5">{res.customerPhone}</div>}
                        {res.merchantOrder && <div className="text-xs font-mono text-foreground/30 mt-0.5">{res.merchantOrder}</div>}
                      </td>
                      {/* Producto */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-foreground/65 truncate max-w-[200px]">{res.productName}</div>
                        {res.paymentMethod && (
                          <div className="text-xs text-foreground/40 mt-0.5">{getPaymentMethodLabel(res.paymentMethod)}</div>
                        )}
                        {res.invoiceNumber && (
                          <button
                            onClick={() => { setTab("invoices"); setInvoiceSearch(res.invoiceNumber); }}
                            className="text-xs font-mono text-sky-400/60 hover:text-sky-300 transition-colors flex items-center gap-1 mt-0.5">
                            <Receipt className="w-2.5 h-2.5" />{res.invoiceNumber}
                          </button>
                        )}
                      </td>
                      {/* Estado Reserva */}
                      <td className="px-4 py-3">
                        {res.statusReservation ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.statusReservation === "CONFIRMADA" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                            res.statusReservation === "PENDIENTE_CONFIRMACION" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                            res.statusReservation === "EN_CURSO" ? "bg-blue-500/15 text-blue-400 border-blue-500/30" :
                            res.statusReservation === "FINALIZADA" ? "bg-slate-500/15 text-slate-400 border-slate-500/30" :
                            res.statusReservation === "NO_SHOW" ? "bg-orange-500/15 text-orange-400 border-orange-500/30" :
                            res.statusReservation === "ANULADA" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                            "bg-slate-500/15 text-slate-400 border-slate-500/30"
                          }`}>
                            {res.statusReservation === "PENDIENTE_CONFIRMACION" ? "Pend. conf." :
                             res.statusReservation === "CONFIRMADA" ? "✅ Confirmada" :
                             res.statusReservation === "EN_CURSO" ? "▶ En curso" :
                             res.statusReservation === "FINALIZADA" ? "Finalizada" :
                             res.statusReservation === "NO_SHOW" ? "⚠️ No show" :
                             res.statusReservation === "ANULADA" ? "❌ Anulada" :
                             res.statusReservation}
                          </span>
                        ) : (
                          // Fallback al status legacy
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.status === "paid" || res.status === "confirmed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                            res.status === "pending_payment" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                            res.status === "cancelled" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                            "bg-slate-500/15 text-slate-400 border-slate-500/30"
                          }`}>
                            {res.status === "paid" || res.status === "confirmed" ? "✅ Confirmada" :
                             res.status === "pending_payment" ? "⏳ Pendiente" :
                             res.status === "cancelled" ? "❌ Cancelada" : res.status}
                          </span>
                        )}
                        {res.cancellationRequestId && (
                          <div className="mt-1">
                            <span className="inline-flex items-center text-[9px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-1.5 py-0.5 rounded">⚠️ ANULACIÓN #{res.cancellationRequestId}</span>
                          </div>
                        )}
                        {res.dateModified && (
                          <div className="mt-1">
                            <span className="inline-flex items-center text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded">⚠️ FECHA MOD.</span>
                          </div>
                        )}
                      </td>
                      {/* Estado Pago */}
                      <td className="px-4 py-3">
                        {res.statusPayment ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.statusPayment === "PAGADO" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                            res.statusPayment === "PAGO_PARCIAL" ? "bg-sky-500/15 text-sky-400 border-sky-500/30" :
                            res.statusPayment === "PENDIENTE_VALIDACION" ? "bg-violet-500/15 text-violet-400 border-violet-500/30" :
                            "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          }`}>
                            {res.statusPayment === "PAGADO" ? "💰 Pagado" :
                             res.statusPayment === "PAGO_PARCIAL" ? "⚡ Parcial" :
                             res.statusPayment === "PENDIENTE_VALIDACION" ? "🔍 Validación" :
                             "⏳ Pendiente"}
                          </span>
                        ) : (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            res.status === "paid" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                            "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          }`}>
                            {res.status === "paid" ? "💰 Pagado" : "⏳ Pendiente"}
                          </span>
                        )}
                      </td>
                      {/* Canal */}
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                          res.channel === "tpv" || res.channel === "TPV_FISICO" ? "text-violet-300 bg-violet-500/15 border-violet-500/30" :
                          res.channel === "crm" || res.channel === "VENTA_DELEGADA" ? "text-purple-300 bg-purple-500/15 border-purple-500/30" :
                          res.channel === "web" || res.channel === "ONLINE_DIRECTO" ? "text-sky-300 bg-sky-500/15 border-sky-500/30" :
                          res.channel === "ONLINE_ASISTIDO" ? "text-blue-300 bg-blue-500/15 border-blue-500/30" :
                          res.channel === "telefono" ? "text-amber-300 bg-amber-500/15 border-amber-500/30" :
                          res.channel === "PARTNER" ? "text-orange-300 bg-orange-500/15 border-orange-500/30" :
                          res.channel === "groupon" || res.originSource === "coupon_redemption" ? "text-orange-300 bg-orange-500/15 border-orange-500/30" :
                          "text-foreground/50 bg-foreground/[0.05] border-foreground/[0.12]"
                        }`}>
                          {res.channel === "tpv" || res.channel === "TPV_FISICO" ? "🖥️ TPV" :
                           res.channel === "crm" || res.channel === "VENTA_DELEGADA" ? "💼 Delegada" :
                           res.channel === "web" || res.channel === "ONLINE_DIRECTO" ? "🌐 Online" :
                           res.channel === "ONLINE_ASISTIDO" ? "🤝 Asistido" :
                           res.channel === "telefono" ? "📞 Tel." :
                           res.channel === "PARTNER" ? "🤝 Partner" :
                           res.channel === "groupon" || res.originSource === "coupon_redemption" ? `🎫 ${res.platformName ?? "Cupón"}` :
                           res.channel ?? "—"}
                        </span>
                        {(res.channel === "tpv" || res.channel === "TPV_FISICO") && (res as any).tpvOperationNumber ? (
                          <a
                            href={`/admin/contabilidad/operaciones-tpv?search=${encodeURIComponent((res as any).tpvOperationNumber)}`}
                            className="block text-[9px] text-violet-400/70 hover:text-violet-300 hover:underline mt-0.5 font-mono truncate max-w-[80px]"
                          >
                            #{(res as any).tpvOperationNumber}
                          </a>
                        ) : res.channelDetail ? (
                          <div className="text-[9px] text-foreground/40 mt-0.5 truncate max-w-[80px]">{res.channelDetail}</div>
                        ) : null}
                      </td>
                      {/* F. Compra */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-xs text-foreground/60">{new Date(res.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      {/* F. Actividad */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {res.bookingDate ? (
                          <div className="text-xs text-foreground/70 font-medium">{res.bookingDate}</div>
                        ) : (
                          <span className="text-xs text-foreground/30">—</span>
                        )}
                      </td>
                      {/* Importe */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-orange-400">{((res.amountPaid ?? 0) / 100).toFixed(2)} €</span>
                        {res.amountPaid !== res.amountTotal && (
                          <div className="text-xs text-foreground/40">{((res.amountTotal ?? 0) / 100).toFixed(2)} € total</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Ver detalles */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-sky-300 h-7 w-7 p-0"
                            onClick={() => setViewResId(res.id)}
                            title="Ver detalles">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-amber-300 h-7 w-7 p-0"
                            onClick={() => {
                              setEditResData(res);
                              setEditResStatus(res.status ?? "");
                              setEditResNotes(res.notes ?? "");
                              setEditResStatusReservation("");
                              setEditResStatusPayment("");
                              setEditResChannel("");
                              setEditResChannelDetail("");
                              setEditResNewDate("");
                              setEditResDateReason("");
                              setShowChangeDateSection(false);
                              setEditResId(res.id);
                            }}
                            title="Editar reserva">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {/* Reenviar al cliente */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-blue-300 h-7 w-7 p-0"
                            onClick={() => resendResMutation.mutate({ id: res.id })}
                            disabled={resendResMutation.isPending}
                            title="Reenviar confirmación al cliente">
                            {resendResMutation.isPending
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <Send className="w-3.5 h-3.5" />}
                          </Button>
                          {/* Descargar PDF factura */}
                          <Button size="sm" variant="ghost"
                            className={`h-7 w-7 p-0 ${(res as any).invoicePdfUrl ? "text-foreground/50 hover:text-emerald-300" : "text-foreground/20 cursor-not-allowed"}`}
                            onClick={() => (res as any).invoicePdfUrl && window.open((res as any).invoicePdfUrl, "_blank")}
                            disabled={!(res as any).invoicePdfUrl}
                            title={(res as any).invoicePdfUrl ? "Descargar factura PDF" : "Sin factura PDF"}>
                            <FileDown className="w-3.5 h-3.5" />
                          </Button>
                          {/* Generar factura — cualquier reserva sin factura */}
                          {!res.invoiceId && !res.invoiceNumber && (
                            <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-violet-300 h-7 w-7 p-0"
                              onClick={() => setGenInvoiceResId(res.id)}
                              title="Generar factura">
                              <FilePlus className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Anular reserva */}
                          {res.status !== "cancelled" && (
                            <Button size="sm" variant="ghost"
                              className="text-foreground/50 hover:text-orange-400 h-7 w-7 p-0"
                              onClick={() => { setCancelReservationId(res.id); setCancelReservationName(res.customerName); }}
                              title="Anular reserva">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Eliminar */}
                          <Button size="sm" variant="ghost" className="text-foreground/50 hover:text-red-400 h-7 w-7 p-0"
                            onClick={() => setDeleteResId(res.id)}
                            title="Eliminar reserva">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resData && resData.total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-foreground/[0.10]">
                <span className="text-sm text-foreground/50">
                  Página {resPage + 1} de {Math.ceil(resData.total / PAGE_SIZE)} · {resData.total} reservas
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setResPage(p => p - 1)}
                    disabled={resPage === 0}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >← Anterior</button>
                  <button
                    onClick={() => setResPage(p => p + 1)}
                    disabled={(resPage + 1) * PAGE_SIZE >= resData.total}
                    className="px-3 py-1.5 text-sm rounded-lg border border-foreground/20 disabled:opacity-30 hover:bg-foreground/10 transition-colors"
                  >Siguiente →</button>
                </div>
              </div>
            )}
            </div>
          )}

          {/* ─── TABLA DE FACTURAS ──────────────────────────────────────────────── */}
          {tab === "invoices" && (
            <div>
              {/* Filtros de facturas */}
              <div className="flex flex-wrap gap-2 mb-3">
                {(["all", "generada", "enviada", "cobrada", "anulada", "abonada"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setInvoiceStatusFilter(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                      invoiceStatusFilter === s
                        ? "bg-orange-600 text-white border-orange-600"
                        : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12] hover:bg-foreground/[0.08]"
                    }`}
                  >
                    {s === "all" ? "Todas" : s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
                <div className="ml-auto flex gap-2">
                  {(["all", "factura", "abono"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setInvoiceTypeFilter(t)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-all border ${
                        invoiceTypeFilter === t
                          ? "bg-violet-600 text-white border-violet-600"
                          : "bg-foreground/[0.05] text-foreground/60 border-foreground/[0.12] hover:bg-foreground/[0.08]"
                      }`}
                    >
                      {t === "all" ? "Todos los tipos" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtro por rango de fechas + accesos rápidos */}
              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 mb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-foreground/60 text-xs">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="font-medium">Período:</span>
                  </div>
                  {/* Accesos rápidos */}
                  {([
                    { label: "Hoy", fn: () => { const d = new Date().toISOString().slice(0,10); setInvoiceDateFrom(d); setInvoiceDateTo(d); } },
                    { label: "Esta semana", fn: () => { const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1); const sun = new Date(mon); sun.setDate(mon.getDate() + 6); setInvoiceDateFrom(mon.toISOString().slice(0,10)); setInvoiceDateTo(sun.toISOString().slice(0,10)); } },
                    { label: "Este mes", fn: () => { const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1); const last = new Date(now.getFullYear(), now.getMonth() + 1, 0); setInvoiceDateFrom(first.toISOString().slice(0,10)); setInvoiceDateTo(last.toISOString().slice(0,10)); } },
                    { label: "T1", fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-01-01`); setInvoiceDateTo(`${y}-03-31`); } },
                    { label: "T2", fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-04-01`); setInvoiceDateTo(`${y}-06-30`); } },
                    { label: "T3", fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-07-01`); setInvoiceDateTo(`${y}-09-30`); } },
                    { label: "T4", fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-10-01`); setInvoiceDateTo(`${y}-12-31`); } },
                    { label: "Este año", fn: () => { const y = new Date().getFullYear(); setInvoiceDateFrom(`${y}-01-01`); setInvoiceDateTo(`${y}-12-31`); } },
                  ]).map(({ label, fn }) => (
                    <button key={label} onClick={fn}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-foreground/[0.05] text-foreground/65 border border-foreground/[0.12] hover:bg-sky-600/30 hover:text-sky-300 hover:border-sky-500/40 transition-all">
                      {label}
                    </button>
                  ))}
                  {/* Inputs de fecha */}
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="date"
                      value={invoiceDateFrom}
                      onChange={e => setInvoiceDateFrom(e.target.value)}
                      className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-2 py-1 text-xs text-foreground/70 focus:outline-none focus:border-sky-500/50 [color-scheme:dark]"
                    />
                    <span className="text-foreground/40 text-xs">→</span>
                    <input
                      type="date"
                      value={invoiceDateTo}
                      onChange={e => setInvoiceDateTo(e.target.value)}
                      className="bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-2 py-1 text-xs text-foreground/70 focus:outline-none focus:border-sky-500/50 [color-scheme:dark]"
                    />
                    {(invoiceDateFrom || invoiceDateTo) && (
                      <button onClick={() => { setInvoiceDateFrom(""); setInvoiceDateTo(""); }}
                        className="text-foreground/40 hover:text-foreground/65 transition-colors text-xs px-1.5 py-1 rounded hover:bg-foreground/[0.05]">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Panel de resumen del período */}
              {invoicesData?.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
                  <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 text-center">
                    <div className="text-xs text-foreground/50 mb-1">Docs. en período</div>
                    <div className="text-lg font-bold text-foreground">{invoicesData.total}</div>
                  </div>
                  <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-3 text-center">
                    <div className="text-xs text-foreground/50 mb-1">Base imponible</div>
                    <div className="text-lg font-bold text-sky-400">{invoicesData.summary.subtotal.toFixed(2)} €</div>
                  </div>
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
                    <div className="text-xs text-orange-300/60 mb-1">Bruto (IVA incl.)</div>
                    <div className="text-lg font-bold text-orange-400">{invoicesData.summary.grandTotal.toFixed(2)} €</div>
                    <div className="text-xs text-foreground/40">IVA: {invoicesData.summary.tax.toFixed(2)} €</div>
                  </div>
                  {(invoicesData.summary as any).abonosTotal > 0 && (
                    <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 text-center">
                      <div className="text-xs text-violet-300/60 mb-1">Total abonos</div>
                      <div className="text-lg font-bold text-violet-400">-{(invoicesData.summary as any).abonosTotal.toFixed(2)} €</div>
                    </div>
                  )}
                  {(invoicesData.summary as any).abonosTotal > 0 && (
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                      <div className="text-xs text-emerald-300/60 mb-1">Neto real</div>
                      <div className="text-lg font-bold text-emerald-400">{(invoicesData.summary as any).netTotal.toFixed(2)} €</div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Número</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden md:table-cell">Método pago</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Total</th>
                      <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium hidden sm:table-cell">Fecha</th>
                      <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesLoading ? (
                      <tr><td colSpan={7} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : !invoicesData?.items?.length ? (
                      <tr><td colSpan={7} className="text-center py-12 text-foreground/40 text-sm">
                        <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No hay facturas
                      </td></tr>
                    ) : invoicesData.items.map((inv: any) => (
                      <tr key={inv.id} className={`border-t border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors ${inv.invoiceType === "abono" ? "bg-violet-500/3" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono font-bold text-foreground">{inv.invoiceNumber}</span>
                            {inv.invoiceType === "abono" && (
                              <span className="inline-flex items-center text-[9px] font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 px-1.5 py-0.5 rounded">ABONO</span>
                            )}
                          </div>
                          {/* Factura abonada → mostrar el nº del abono emitido */}
                          {inv.status === "abonada" && inv.creditNoteNumber && (
                            <div className="mt-0.5">
                              <button
                                onClick={() => setInvoiceSearch(inv.creditNoteNumber)}
                                className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors flex items-center gap-1"
                                title="Ver factura de abono"
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                                Abono: {inv.creditNoteNumber}
                              </button>
                            </div>
                          )}
                          {/* Abono → mostrar la factura original que rectifica */}
                          {inv.invoiceType === "abono" && inv.originalInvoiceNumber && (
                            <div className="mt-0.5">
                              <button
                                onClick={() => setInvoiceSearch(inv.originalInvoiceNumber)}
                                className="text-[10px] text-orange-400/70 hover:text-orange-300 transition-colors flex items-center gap-1"
                                title="Ver factura original"
                              >
                                <Receipt className="w-2.5 h-2.5" />
                                Rectifica: {inv.originalInvoiceNumber}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-foreground">{inv.clientName}</div>
                          <div className="text-xs text-foreground/50">{inv.clientEmail}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex flex-col gap-1">
                            {getPaymentMethodBadge(inv.paymentMethod)}
                            {inv.transferProofUrl && (
                              <a
                                href={inv.transferProofUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors"
                                title="Ver justificante de transferencia"
                              >
                                <Paperclip className="w-3 h-3" />
                                Justificante
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getInvoiceStatusBadge(inv.status)}
                          {inv.invoiceType === "abono" && (
                            <div className="mt-1">
                              <span className="inline-flex items-center text-[9px] font-bold text-violet-400/70 border border-violet-500/20 px-1.5 py-0.5 rounded">
                                Fact. rectificativa
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {inv.invoiceType === "abono" ? (
                            <span className="text-sm font-bold text-violet-400">{Number(inv.total).toFixed(2)} €</span>
                          ) : (
                            <span className="text-sm font-bold text-orange-400">{Number(inv.total).toFixed(2)} €</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="text-xs text-foreground/50">{new Date(inv.createdAt).toLocaleDateString("es-ES")}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* PDF: Generar si no existe, ver+descargar si existe */}
                            {inv.pdfUrl ? (
                              <>
                                <button onClick={() => viewInvoicePdf(inv)} title="Visualizar factura"
                                  className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-sky-400 transition-colors">
                                  <Eye className="w-4 h-4" />
                                </button>
                                <button onClick={() => downloadInvoicePdf(inv)} title="Descargar factura"
                                  className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-emerald-400 transition-colors">
                                  <FileDown className="w-4 h-4" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => regenerateInvoicePdfMutation.mutate({ invoiceId: inv.id })}
                                disabled={regenerateInvoicePdfMutation.isPending}
                                title="Generar PDF"
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-amber-400 transition-colors disabled:opacity-40">
                                {regenerateInvoicePdfMutation.isPending
                                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                                  : <FilePlus className="w-4 h-4" />}
                              </button>
                            )}
                            {/* Reenviar */}
                            {["generada", "enviada"].includes(inv.status) && (
                              <button onClick={() => resendInvoiceMutation.mutate({ invoiceId: inv.id })} title="Reenviar por email"
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-sky-400 transition-colors">
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {/* Confirmar pago manual */}
                            {["generada", "enviada"].includes(inv.status) && inv.invoiceType !== "abono" && (
                              <button onClick={() => setConfirmPaymentInvoiceId(inv.id)} title="Confirmar pago manual"
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-emerald-400 transition-colors">
                                <CreditCard className="w-4 h-4" />
                              </button>
                            )}
                            {/* Generar abono */}
                            {inv.status === "cobrada" && inv.invoiceType !== "abono" && (
                              <button onClick={() => setCreditNoteInvoiceId(inv.id)} title="Generar factura de abono"
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-violet-400 transition-colors">
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                            {/* Anular */}
                            {!["anulada", "abonada"].includes(inv.status) && (
                              <button onClick={() => setVoidInvoiceId(inv.id)} title="Anular factura"
                                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-red-400 transition-colors">
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
                            {/* Eliminar */}
                            <button onClick={() => setDeleteInvoiceId(inv.id)} title="Eliminar factura"
                              className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/50 hover:text-rose-600 transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* ─── TAB: ANULACIONES ─────────────────────────────────────────────── */}
          {tab === "anulaciones" && (
            <div className="space-y-4">
              {/* KPIs fila 1 */}
              {anulKpis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    { label: "Total", value: anulKpis.total, color: "border-foreground/[0.08]" },
                    { label: "Recibidas", value: anulKpis.recibidas, color: "border-blue-500/20" },
                    { label: "En revisión", value: anulKpis.enRevision, color: "border-amber-500/20" },
                    { label: "Pend. docs", value: anulKpis.pendienteDocumentacion, color: "border-orange-500/20" },
                    { label: "Incidencias", value: anulKpis.incidencias, color: "border-red-500/20" },
                    { label: "Cerradas", value: anulKpis.cerradas, color: "border-gray-500/20" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-foreground/[0.03] border ${color} rounded-xl p-4`}>
                      <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* KPIs fila 2 */}
              {anulKpis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Aceptadas total", value: anulKpis.resueltasTotal, color: "border-green-500/20" },
                    { label: "Aceptadas parcial", value: anulKpis.resueltasParcial, color: "border-teal-500/20" },
                    { label: "Rechazadas", value: anulKpis.rechazadas, color: "border-red-500/20" },
                    { label: "Bonos enviados", value: anulKpis.compensadasBono, color: "border-purple-500/20" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-foreground/[0.03] border ${color} rounded-xl p-4`}>
                      <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-foreground">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Filtros */}
              <div className="flex flex-wrap gap-3">
                <Select value={anulOpFilter} onValueChange={setAnulOpFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder="Estado operativo" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-foreground/[0.12]">
                    <SelectItem value="all" className="text-foreground/70 text-xs">Todos los estados</SelectItem>
                    <SelectItem value="recibida" className="text-foreground/70 text-xs">Recibida</SelectItem>
                    <SelectItem value="en_revision" className="text-foreground/70 text-xs">En revisión</SelectItem>
                    <SelectItem value="pendiente_documentacion" className="text-foreground/70 text-xs">Pend. documentación</SelectItem>
                    <SelectItem value="pendiente_decision" className="text-foreground/70 text-xs">Pend. decisión</SelectItem>
                    <SelectItem value="resuelta" className="text-foreground/70 text-xs">Resuelta</SelectItem>
                    <SelectItem value="cerrada" className="text-foreground/70 text-xs">Cerrada</SelectItem>
                    <SelectItem value="incidencia" className="text-foreground/70 text-xs">Incidencia</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulResFilter} onValueChange={setAnulResFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder="Resolución" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-foreground/[0.12]">
                    <SelectItem value="all" className="text-foreground/70 text-xs">Toda resolución</SelectItem>
                    <SelectItem value="sin_resolver" className="text-foreground/70 text-xs">Sin resolver</SelectItem>
                    <SelectItem value="rechazada" className="text-foreground/70 text-xs">Rechazada</SelectItem>
                    <SelectItem value="aceptada_total" className="text-foreground/70 text-xs">Aceptada total</SelectItem>
                    <SelectItem value="aceptada_parcial" className="text-foreground/70 text-xs">Aceptada parcial</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulFinFilter} onValueChange={setAnulFinFilter}>
                  <SelectTrigger className="w-44 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder="Estado financiero" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-foreground/[0.12]">
                    <SelectItem value="all" className="text-foreground/70 text-xs">Todo financiero</SelectItem>
                    <SelectItem value="sin_compensacion" className="text-foreground/70 text-xs">Sin compensación</SelectItem>
                    <SelectItem value="pendiente_devolucion" className="text-foreground/70 text-xs">Pend. devolución</SelectItem>
                    <SelectItem value="devuelta_economicamente" className="text-foreground/70 text-xs">Devuelta</SelectItem>
                    <SelectItem value="pendiente_bono" className="text-foreground/70 text-xs">Pend. bono</SelectItem>
                    <SelectItem value="compensada_bono" className="text-foreground/70 text-xs">Bono enviado</SelectItem>
                    <SelectItem value="incidencia_economica" className="text-foreground/70 text-xs">Incidencia ec.</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulReasonFilter} onValueChange={setAnulReasonFilter}>
                  <SelectTrigger className="w-40 bg-foreground/[0.05] border-foreground/[0.12] text-foreground/70 text-xs h-9">
                    <SelectValue placeholder="Motivo" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-foreground/[0.12]">
                    <SelectItem value="all" className="text-foreground/70 text-xs">Todos los motivos</SelectItem>
                    <SelectItem value="meteorologicas" className="text-foreground/70 text-xs">Meteorológicas</SelectItem>
                    <SelectItem value="accidente" className="text-foreground/70 text-xs">Accidente</SelectItem>
                    <SelectItem value="enfermedad" className="text-foreground/70 text-xs">Enfermedad</SelectItem>
                    <SelectItem value="desistimiento" className="text-foreground/70 text-xs">Desistimiento</SelectItem>
                    <SelectItem value="otra" className="text-foreground/70 text-xs">Otra</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAnul()}
                  className="gap-1.5 border-foreground/[0.12] text-foreground/50 hover:text-foreground h-9"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Actualizar
                </Button>
                <Button
                  size="sm"
                  onClick={() => window.open("/solicitar-anulacion", "_blank")}
                  className="gap-1.5 bg-orange-500/80 hover:bg-orange-600 text-white h-9 ml-auto"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Ver formulario público
                </Button>
              </div>
              {/* Tabla */}
              <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">#</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Solicitante</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Reserva</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Motivo</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Fecha actividad</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado op.</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Resolución</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Financiero</th>
                        <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Fecha</th>
                        <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anulLoading && (
                        <tr>
                          <td colSpan={10} className="text-center py-12 text-foreground/40">
                            <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                          </td>
                        </tr>
                      )}
                      {!anulLoading && anulError && (
                        <tr>
                          <td colSpan={10} className="text-center py-12">
                            <AlertTriangle className="w-8 h-8 text-red-400/60 mx-auto mb-2" />
                            <p className="text-red-400/70 text-sm font-medium">Error al cargar las solicitudes</p>
                            <button onClick={() => refetchAnul()} className="mt-2 text-xs text-foreground/40 hover:text-foreground/70 underline">Reintentar</button>
                          </td>
                        </tr>
                      )}
                      {!anulLoading && !anulError && anulRows.length === 0 && (
                        <tr>
                          <td colSpan={10} className="text-center py-12">
                            <AlertTriangle className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
                            <p className="text-foreground/40 text-sm">No hay solicitudes que coincidan con los filtros</p>
                          </td>
                        </tr>
                      )}
                      {anulRows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                          onClick={() => setSelectedAnulId(row.id)}
                        >
                          <td className="px-4 py-3 text-foreground/50 text-sm font-mono">#{row.id}</td>
                          <td className="px-4 py-3">
                            <p className="text-white text-sm font-medium">{row.fullName}</p>
                            {row.email && <p className="text-foreground/50 text-xs">{row.email}</p>}
                            {row.locator && <p className="text-foreground/40 text-xs font-mono">{row.locator}</p>}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            {row.linkedReservationId && row.reservationNumber ? (
                              <button
                                onClick={() => setViewResId(row.linkedReservationId!)}
                                className="font-mono text-xs text-orange-400 hover:text-orange-300 hover:underline transition-colors"
                                title="Ver reserva"
                              >
                                {row.reservationNumber}
                              </button>
                            ) : (
                              <span className="text-foreground/30 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {row.reason === "meteorologicas" && <CloudLightning className="w-4 h-4 text-blue-400" />}
                              {row.reason === "accidente" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                              {row.reason === "enfermedad" && <HeartPulse className="w-4 h-4 text-pink-400" />}
                              {row.reason === "desistimiento" && <XCircle className="w-4 h-4 text-foreground/50" />}
                              {row.reason === "otra" && <HelpCircle className="w-4 h-4 text-foreground/50" />}
                              <span className="text-foreground/65 text-xs capitalize">{row.reason}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-foreground/65 text-sm">{row.activityDate}</td>
                          <td className="px-4 py-3">
                            <AnulOpBadge status={row.operationalStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulResBadge status={row.resolutionStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulFinBadge status={row.financialStatus} />
                          </td>
                          <td className="px-4 py-3 text-foreground/50 text-xs">
                            {new Date(row.createdAt).toLocaleDateString("es-ES")}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setSelectedAnulId(row.id)}
                                className="p-1.5 rounded-lg text-foreground/50 hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
                                title="Ver detalle"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteAnulId(row.id)}
                                className="p-1.5 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Eliminar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {anulRows.length > 0 && (
                  <div className="px-4 py-3 border-t border-foreground/[0.08] text-xs text-foreground/40">
                    {anulRows.length} solicitud{anulRows.length !== 1 ? "es" : ""}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── TAB: Pagos Pendientes ─── */}
          {tab === "bonos" && (
            <BonosManager onOpenCancellation={(id) => { setSelectedAnulId(id); }} onOpenReservation={(id) => setViewResId(id)} />
          )}

          {tab === "pagos_pendientes" && (
            <PagosPendientesTab />
          )}
        </div>
      </div>

      {/* Modals */}

      {/* ─── MODALES DE FACTURAS ──────────────────────────────────────────────── */}
      {/* Confirmar pago manual */}
      <Dialog open={confirmPaymentInvoiceId !== null} onOpenChange={(o) => !o && setConfirmPaymentInvoiceId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-400" /> Confirmar pago manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">Método de pago</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="transferencia" className="text-white">🏦 Transferencia bancaria</SelectItem>
                  <SelectItem value="efectivo" className="text-white">💵 Efectivo</SelectItem>
                  <SelectItem value="otro" className="text-white">❓ Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-foreground/50">Se marcará la factura como cobrada y se actualizará la reserva asociada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmPaymentInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button size="sm" onClick={() => confirmPaymentInvoiceId !== null && confirmManualPaymentMutation.mutate({ invoiceId: confirmPaymentInvoiceId, paymentMethod })}
              disabled={confirmManualPaymentMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {confirmManualPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Confirmar cobro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generar abono */}
      <Dialog open={creditNoteInvoiceId !== null} onOpenChange={(o) => { if (!o) { setCreditNoteInvoiceId(null); setCreditNoteReason(""); } }}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-violet-400" /> Generar factura de abono
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">Motivo del abono *</Label>
              <Textarea
                value={creditNoteReason}
                onChange={(e) => setCreditNoteReason(e.target.value)}
                placeholder="Ej: Cancelación por condiciones meteorológicas"
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 resize-none"
                rows={3}
              />
            </div>
            <p className="text-xs text-foreground/50">Se generará una factura de abono por el importe total. La factura original quedará marcada como abonada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setCreditNoteInvoiceId(null); setCreditNoteReason(""); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button size="sm"
              onClick={() => creditNoteInvoiceId !== null && creditNoteReason.trim() && createCreditNoteMutation.mutate({ invoiceId: creditNoteInvoiceId, reason: creditNoteReason })}
              disabled={createCreditNoteMutation.isPending || !creditNoteReason.trim()}
              className="bg-violet-600 hover:bg-violet-700 text-white">
              {createCreditNoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <RotateCcw className="w-4 h-4 mr-1" />}
              Generar abono
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Anular factura */}
      <Dialog open={voidInvoiceId !== null} onOpenChange={(o) => !o && setVoidInvoiceId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Anular factura
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Esta acción marcará la factura como anulada. No se puede deshacer. Para reembolsos, usa la opción de generar abono.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button size="sm"
              onClick={() => voidInvoiceId !== null && voidInvoiceMutation.mutate({ invoiceId: voidInvoiceId })}
              disabled={voidInvoiceMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white">
              {voidInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
              Anular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar factura */}
      <Dialog open={deleteInvoiceId !== null} onOpenChange={(o) => !o && setDeleteInvoiceId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-500" /> Eliminar factura
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-foreground/70">Esta acción eliminará la factura permanentemente.</p>
            <ul className="text-xs text-foreground/60 list-disc list-inside space-y-1">
              <li>La reserva asociada quedará sin factura asignada</li>
              <li>Si venía de un presupuesto, su estado volverá a <span className="text-amber-400">pendiente</span></li>
              <li>Esta acción no se puede deshacer</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteInvoiceId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button size="sm"
              onClick={() => deleteInvoiceId !== null && deleteInvoiceMutation.mutate({ invoiceId: deleteInvoiceId })}
              disabled={deleteInvoiceMutation.isPending}
              className="bg-rose-700 hover:bg-rose-800 text-white">
              {deleteInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nuevo Presupuesto Directo */}
      <Dialog open={showDirectQuoteModal} onOpenChange={(o) => !o && setShowDirectQuoteModal(false)}>
        {showDirectQuoteModal && (
          <DirectQuoteModal onClose={() => setShowDirectQuoteModal(false)} />
        )}
      </Dialog>
      {/* Nuevo Lead Manual */}
      <Dialog open={showNewLeadModal} onOpenChange={(o) => !o && setShowNewLeadModal(false)}>
        {showNewLeadModal && (
          <NewLeadModal onClose={() => setShowNewLeadModal(false)} />
        )}
      </Dialog>
      {/* Nueva Reserva Manual */}
      <Dialog open={showNewReservationModal} onOpenChange={(o) => !o && setShowNewReservationModal(false)}>
        {showNewReservationModal && (
          <NewReservationModal onClose={() => setShowNewReservationModal(false)} />
        )}
      </Dialog>

      <Dialog open={selectedLeadId !== null} onOpenChange={(o) => !o && setSelectedLeadId(null)}>
        {selectedLeadId !== null && (
          <LeadDetailModal
            leadId={selectedLeadId}
            onClose={() => setSelectedLeadId(null)}
            onConvert={(id, name) => { setConvertLeadId(id); setConvertLeadName(name ?? ""); }}
          />
        )}
      </Dialog>

      <Dialog open={convertLeadId !== null} onOpenChange={(o) => !o && setConvertLeadId(null)}>
        {convertLeadId !== null && (
          <QuoteBuilderModal
            leadId={convertLeadId}
            leadName={convertLeadName}
            onClose={() => { setConvertLeadId(null); setConvertLeadName(""); }}
          />
        )}
      </Dialog>

      <Dialog open={selectedQuoteId !== null} onOpenChange={(o) => !o && setSelectedQuoteId(null)}>
        {selectedQuoteId !== null && (
          <QuoteDetailModal
            quoteId={selectedQuoteId}
            onClose={() => setSelectedQuoteId(null)}
          />
        )}
      </Dialog>

      {/* Edit Lead */}
      <Dialog open={editLeadId !== null} onOpenChange={(o) => !o && setEditLeadId(null)}>
        {editLeadId !== null && (
          <LeadEditModal leadId={editLeadId} onClose={() => setEditLeadId(null)} />
        )}
      </Dialog>

      {/* Delete Lead confirmation */}
      <Dialog open={deleteLeadId !== null} onOpenChange={(o) => !o && setDeleteLeadId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar lead
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Esta acción es irreversible. Se eliminará el lead y toda su actividad asociada.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteLeadId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => deleteLeadId !== null && deleteLead.mutate({ id: deleteLeadId })}
              disabled={deleteLead.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteLead.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Quote */}
      <Dialog open={editQuoteId !== null} onOpenChange={(o) => !o && setEditQuoteId(null)}>
        {editQuoteId !== null && (
          <QuoteEditModal quoteId={editQuoteId} onClose={() => setEditQuoteId(null)} />
        )}
      </Dialog>

      {/* Delete Quote confirmation */}
      <Dialog open={deleteQuoteId !== null} onOpenChange={(o) => !o && setDeleteQuoteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar presupuesto
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Esta acción es irreversible. Se eliminará el presupuesto y sus facturas asociadas.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => deleteQuoteId !== null && deleteQuote.mutate({ id: deleteQuoteId })}
              disabled={deleteQuote.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteQuote.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Send Quote confirmation */}
      <Dialog open={sendQuoteId !== null} onOpenChange={(o) => !o && setSendQuoteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-orange-400" /> Enviar presupuesto al cliente
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Se enviará el presupuesto por email al cliente y se actualizará el estado a "Enviado".</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => sendQuoteId !== null && sendQuoteMutation.mutate({ id: sendQuoteId, origin: window.location.origin })}
              disabled={sendQuoteMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {sendQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Payment — con paso previo por método */}
      <Dialog open={confirmPaymentId !== null} onOpenChange={(o) => { if (!o) { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); } }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">Selecciona el método de pago y completa los datos antes de confirmar.</p>
            {/* Selector de método */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setConfirmPayMethodRow(m); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setTpvOpSearchForRow(""); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    confirmPayMethodRow === m ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-foreground/[0.12] bg-foreground/[0.05] text-foreground/60 hover:border-white/25 hover:text-foreground/80"
                  }`}
                >
                  {m === "tarjeta" && <CreditCard className="w-5 h-5" />}
                  {m === "transferencia" && <Banknote className="w-5 h-5" />}
                  {m === "efectivo" && <Receipt className="w-5 h-5" />}
                  {m === "tarjeta" ? "Tarjeta" : m === "transferencia" ? "Transferencia" : "Efectivo"}
                </button>
              ))}
            </div>
            {/* Campo específico por método */}
            {confirmPayMethodRow === "tarjeta" && (
              <div className="space-y-2">
                <div className="space-y-1.5">
                  <Label className="text-foreground/70 text-xs">Nº operación TPV {!selectedTpvOpIdForRow ? "*" : "(auto)"}</Label>
                  <Input value={confirmPayTpvOp} onChange={(e) => setConfirmPayTpvOp(e.target.value)} placeholder="Ej: 000123456789" disabled={!!selectedTpvOpIdForRow} className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm disabled:opacity-50" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-violet-400" />
                    Vincular operación TPV
                  </div>
                  {!selectedTpvOpIdForRow && (
                    <button
                      className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      onClick={() => setShowTpvOpSearchForRow(!showTpvOpSearchForRow)}
                    >
                      {showTpvOpSearchForRow ? "Ocultar" : "Buscar operación"}
                    </button>
                  )}
                </div>
                {selectedTpvOpIdForRow ? (
                  (() => {
                    const op = (tpvOpsForRowQ.data?.data as any[])?.find((o: any) => o.id === selectedTpvOpIdForRow)
                      ?? { id: selectedTpvOpIdForRow, operationNumber: confirmPayTpvOp, amount: "–" };
                    return (
                      <div className="rounded-md border border-violet-500/30 bg-violet-500/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-violet-300">Operación TPV vinculada</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setConfirmPayTpvOp(""); }}>×</button>
                        </div>
                        <div className="text-foreground/70 font-mono">{op.operationNumber ?? "–"}</div>
                        <div className="text-violet-400 font-medium">{op.amount != null ? `${Number(op.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</div>
                      </div>
                    );
                  })()
                ) : showTpvOpSearchForRow ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                      placeholder="Buscar por Nº operación, tarjeta..."
                      value={tpvOpSearchForRow}
                      onChange={(e) => setTpvOpSearchForRow(e.target.value)}
                    />
                    <div className="max-h-40 overflow-y-auto rounded-md border border-white/10 divide-y divide-white/5">
                      {tpvOpsForRowQ.isLoading ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">Buscando...</div>
                      ) : (tpvOpsForRowQ.data?.data as any[] | undefined)?.length === 0 ? (
                        <div className="p-3 text-xs text-foreground/40 text-center">No hay operaciones pendientes</div>
                      ) : (
                        (tpvOpsForRowQ.data?.data as any[] | undefined)?.map((op: any) => (
                          <button
                            key={op.id}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                            onClick={() => { setSelectedTpvOpIdForRow(op.id); setConfirmPayTpvOp(op.operationNumber ?? ""); setShowTpvOpSearchForRow(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono text-white/80">{op.operationNumber}</span>
                              <span className="text-xs text-violet-400 font-medium shrink-0">{Number(op.amount).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €</span>
                            </div>
                            <div className="text-xs text-foreground/40 mt-0.5">{op.terminalCode ?? ""} · {new Date(op.operationDatetime).toLocaleDateString("es-ES")}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            {confirmPayMethodRow === "transferencia" && (
              <div className="space-y-2">
                <div className="text-xs text-foreground/60 font-medium uppercase tracking-wide">
                  Justificante {selectedBankMovementIdForRow ? "(opcional)" : "(obligatorio si no vinculas movimiento)"}
                </div>
                {!confirmPayRowProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingRowProof ? "border-foreground/[0.18] bg-foreground/[0.05]" : "border-foreground/[0.18] bg-foreground/[0.05] hover:border-emerald-500/50 hover:bg-emerald-500/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleRowProofFileChange} disabled={isUploadingRowProof} />
                    {isUploadingRowProof ? (
                      <><RefreshCw className="w-5 h-5 text-foreground/50 animate-spin" /><span className="text-xs text-foreground/50">Subiendo...</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-foreground/50" /><span className="text-xs text-foreground/60">Haz clic o arrastra el justificante (PDF, JPG, PNG)</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">Justificante subido correctamente</span>
                    <a href={confirmPayRowProofUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Ver</a>
                    <button onClick={() => { setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); }} className="text-foreground/40 hover:text-foreground/65 ml-1">×</button>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-foreground/50 font-medium flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-blue-400" />
                    Vincular movimiento bancario
                  </div>
                  {!selectedBankMovementIdForRow && (
                    <button
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                      onClick={() => setShowBankMovementSearchForRow(!showBankMovementSearchForRow)}
                    >
                      {showBankMovementSearchForRow ? "Ocultar" : "Buscar movimiento"}
                    </button>
                  )}
                </div>
                {selectedBankMovementIdForRow ? (
                  (() => {
                    const mv = (bankMovementsForRowQ.data?.data as any[])?.find((m: any) => m.id === selectedBankMovementIdForRow)
                      ?? { id: selectedBankMovementIdForRow, fecha: "–", movimiento: "Movimiento seleccionado", importe: "–" };
                    return (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-emerald-300">Movimiento vinculado</span>
                          <button className="text-foreground/40 hover:text-foreground/70" onClick={() => { setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); }}>×</button>
                        </div>
                        <div className="text-foreground/70 truncate">{mv.movimiento ?? "–"}</div>
                        <div className="flex gap-3 text-foreground/50">
                          <span>{mv.fecha ?? "–"}</span>
                          <span className="text-emerald-400 font-medium">{mv.importe != null ? `${Number(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</span>
                        </div>
                      </div>
                    );
                  })()
                ) : showBankMovementSearchForRow ? (
                  <div className="space-y-2">
                    <input
                      className="w-full text-xs bg-[#0d1526] border border-white/10 rounded-md px-3 py-1.5 text-white placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                      placeholder="Buscar por concepto, importe o fecha..."
                      value={bankMovementSearchForRow}
                      onChange={(e) => setBankMovementSearchForRow(e.target.value)}
                    />
                    {bankMovementsForRowQ.isLoading ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">Buscando...</div>
                    ) : (bankMovementsForRowQ.data?.data as any[] | undefined)?.length === 0 ? (
                      <div className="text-xs text-foreground/40 py-2 text-center">No hay movimientos pendientes</div>
                    ) : (
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(bankMovementsForRowQ.data?.data as any[] | undefined)?.map((mv: any) => (
                          <button
                            key={mv.id}
                            className="w-full text-left px-2.5 py-2 rounded border border-white/10 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors"
                            onClick={() => { setSelectedBankMovementIdForRow(mv.id); setShowBankMovementSearchForRow(false); }}
                          >
                            <div className="text-xs text-white/80 truncate">{mv.movimiento ?? "–"}</div>
                            <div className="flex gap-3 mt-0.5 text-xs text-white/50">
                              <span>{mv.fecha ?? "–"}</span>
                              <span className="text-emerald-400">{mv.importe != null ? `${Number(mv.importe).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "–"}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            {confirmPayMethodRow === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-foreground/70 text-xs">Justificación *</Label>
                <Textarea value={confirmPayNote} onChange={(e) => setConfirmPayNote(e.target.value)} placeholder="Ej: Cobrado en recepción el 31/03/2026" className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); setSelectedBankMovementIdForRow(null); setShowBankMovementSearchForRow(false); setBankMovementSearchForRow(""); setSelectedTpvOpIdForRow(null); setShowTpvOpSearchForRow(false); setTpvOpSearchForRow(""); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              disabled={
                confirmPaymentMutation.isPending ||
                (confirmPayMethodRow === "tarjeta" && !confirmPayTpvOp.trim() && !selectedTpvOpIdForRow) ||
                (confirmPayMethodRow === "transferencia" && !confirmPayRowProofUrl && !selectedBankMovementIdForRow) ||
                (confirmPayMethodRow === "efectivo" && !confirmPayNote.trim())
              }
              onClick={() => {
                if (confirmPaymentId === null) return;
                const payMethod = confirmPayMethodRow === "tarjeta" ? "redsys" : confirmPayMethodRow === "transferencia" ? "transferencia" : "efectivo";
                confirmPaymentMutation.mutate({
                  quoteId: confirmPaymentId,
                  paymentMethod: payMethod,
                  tpvOperationNumber: confirmPayMethodRow === "tarjeta" ? confirmPayTpvOp : undefined,
                  paymentNote: confirmPayMethodRow === "efectivo" ? confirmPayNote : undefined,
                  transferProofUrl: confirmPayMethodRow === "transferencia" ? confirmPayRowProofUrl ?? undefined : undefined,
                  transferProofKey: confirmPayMethodRow === "transferencia" ? confirmPayRowProofKey ?? undefined : undefined,
                  bankMovementId: confirmPayMethodRow === "transferencia" ? selectedBankMovementIdForRow ?? undefined : undefined,
                  cardTerminalOperationId: confirmPayMethodRow === "tarjeta" ? selectedTpvOpIdForRow ?? undefined : undefined,
                });
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {confirmPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              {(selectedBankMovementIdForRow && confirmPayMethodRow === "transferencia") || (selectedTpvOpIdForRow && confirmPayMethodRow === "tarjeta") ? "Confirmar y conciliar" : "Confirmar y generar factura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pago Pendiente desde fila (icono 5) — mismo flujo que el botón del modal de detalle */}
      <Dialog
        open={rowPendingPayQuoteId !== null}
        onOpenChange={(o) => { if (!o) { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); } }}
      >
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" /> Registrar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-foreground/65 text-sm">Se creará la reserva en estado <strong className="text-amber-400">pendiente de cobro</strong>, se registrará el pago pendiente y se enviará un email de recordatorio al cliente con la fecha límite.</p>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">Fecha límite de pago *</Label>
              <Input
                type="date"
                value={rowPendingPayDueDate}
                onChange={(e) => setRowPendingPayDueDate(e.target.value)}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground/70 text-xs">Motivo / nota interna (opcional)</Label>
              <Textarea
                value={rowPendingPayReason}
                onChange={(e) => setRowPendingPayReason(e.target.value)}
                placeholder="Ej: Cliente confirma pago por transferencia la próxima semana..."
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              disabled={!rowPendingPayDueDate || rowPendingPayMutation.isPending}
              onClick={() => {
                if (!rowPendingPayQuoteId || !rowPendingPayDueDate) return;
                // Buscamos el quote en la lista para obtener los datos del cliente
                const q = quotesData?.rows?.find((x: any) => x.id === rowPendingPayQuoteId);
                rowPendingPayMutation.mutate({
                  quoteId: rowPendingPayQuoteId,
                  clientName: (q as any)?.clientName ?? (q as any)?.title ?? "Cliente",
                  clientEmail: (q as any)?.clientEmail ?? undefined,
                  clientPhone: (q as any)?.clientPhone ?? undefined,
                  productName: (q as any)?.title ?? "Experiencia",
                  amountCents: Math.round((Number((q as any)?.total) || 0) * 100),
                  dueDate: rowPendingPayDueDate,
                  reason: rowPendingPayReason,
                  origin: window.location.origin,
                });
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {rowPendingPayMutation.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Registrando...</>
              ) : (
                <><Clock className="w-4 h-4 mr-2" /> Registrar pago pendiente</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Lost */}
      <Dialog open={markLostQuoteId !== null} onOpenChange={(o) => !o && setMarkLostQuoteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Marcar presupuesto como perdido
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Se marcará el presupuesto y la oportunidad como perdidos. Esta acción se puede revertir editando el estado manualmente.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMarkLostQuoteId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => markLostQuoteId !== null && markLostQuoteMutation.mutate({ id: markLostQuoteId })}
              disabled={markLostQuoteMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {markLostQuoteMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
              Marcar perdido
            </Button>
          </DialogFooter>

        </DialogContent>
      </Dialog>

      {/* ─── VER DETALLE RESERVA ───────────────────────────────────────────────────────── */}
      <Dialog open={viewResId !== null} onOpenChange={(o) => !o && setViewResId(null)}>
        {viewResId !== null && (
          <ReservationDetailModal
            reservationId={viewResId}
            onClose={() => setViewResId(null)}
            onGenerateInvoice={(id) => {
              setViewResId(null);
              setGenInvoiceResId(id);
            }}
            onEdit={(id, status) => {
              const resRow = resData?.rows?.find((r: any) => r.id === id);
              setViewResId(null);
              setEditResData(resRow ?? null);
              setEditResStatus(status);
              setEditResNotes("");
              setEditResStatusReservation("");
              setEditResStatusPayment("");
              setEditResChannel("");
              setEditResChannelDetail("");
              setEditResNewDate("");
              setEditResDateReason("");
              setShowChangeDateSection(false);
              setEditResId(id);
            }}
            onCancel={(id, name) => {
              setViewResId(null);
              setCancelReservationId(id);
              setCancelReservationName(name);
            }}
          />
        )}
      </Dialog>

      {/* ─── EDITAR RESERVA (Fase 3) ──────────────────────────────────────────── */}
      <Dialog open={editResId !== null} onOpenChange={(o) => { if (!o) { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); } }}>
        <DialogContent className="max-w-xl bg-[#0d1526] border-foreground/[0.12] text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-amber-400" /> Editar reserva
            </DialogTitle>
          </DialogHeader>

          {/* ── Cabecera con datos del cliente ── */}
          {editResData && (
            <div className="bg-foreground/[0.05] rounded-xl p-3 mb-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-white text-sm">{editResData.customerName}</div>
                {editResData.reservationNumber && (
                  <span className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
                    {editResData.reservationNumber}
                  </span>
                )}
              </div>
              {editResData.customerEmail && (
                <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <Mail className="w-3 h-3" />{editResData.customerEmail}
                </div>
              )}
              {editResData.customerPhone && (
                <div className="flex items-center gap-1.5 text-xs text-foreground/60">
                  <Phone className="w-3 h-3" />{editResData.customerPhone}
                </div>
              )}
              <div className="text-xs text-foreground/40 font-mono mt-0.5">{editResData.merchantOrder}</div>
            </div>
          )}

          <div className="space-y-4 py-1">

            {/* ── Estados separados ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">Estado de reserva</label>
                <select
                  value={editResStatusReservation}
                  onChange={(e) => setEditResStatusReservation(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
                  <option value="">-- Sin cambiar --</option>
                  <option value="PENDIENTE_CONFIRMACION">Pendiente confirmación</option>
                  <option value="CONFIRMADA">Confirmada</option>
                  <option value="EN_CURSO">En curso</option>
                  <option value="FINALIZADA">Finalizada</option>
                  <option value="NO_SHOW">No show</option>
                  <option value="ANULADA">Anulada</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">Estado de pago</label>
                <select
                  value={editResStatusPayment}
                  onChange={(e) => setEditResStatusPayment(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
                  <option value="">-- Sin cambiar --</option>
                  <option value="PENDIENTE">Pendiente</option>
                  <option value="PAGO_PARCIAL">Pago parcial</option>
                  <option value="PENDIENTE_VALIDACION">Pendiente validación</option>
                  <option value="PAGADO">Pagado</option>
                </select>
              </div>
            </div>

            {/* ── Canal ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">Canal</label>
                <select
                  value={editResChannel}
                  onChange={(e) => setEditResChannel(e.target.value)}
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
                  <option value="">-- Sin cambiar --</option>
                  <option value="ONLINE_DIRECTO">Online Directo</option>
                  <option value="ONLINE_ASISTIDO">Online Asistido</option>
                  <option value="VENTA_DELEGADA">Venta Delegada</option>
                  <option value="TPV_FISICO">TPV Físico</option>
                  <option value="PARTNER">Partner</option>
                  <option value="MANUAL">Manual</option>
                  <option value="API">API</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/60 mb-1.5">Detalle canal (ej: Groupon)</label>
                <input
                  type="text"
                  value={editResChannelDetail}
                  onChange={(e) => setEditResChannelDetail(e.target.value)}
                  placeholder="Ej: Groupon, Booking..."
                  className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/50" />
              </div>
            </div>

            {/* ── Notas internas ── */}
            <div>
              <label className="block text-xs text-foreground/60 mb-1.5">Notas internas (opcional)</label>
              <textarea
                value={editResNotes}
                onChange={(e) => setEditResNotes(e.target.value)}
                rows={2}
                placeholder="Añade notas internas sobre esta reserva..."
                className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/50 resize-none" />
            </div>

            {/* ── Cambio de fecha ── */}
            <div className="border border-amber-500/20 rounded-xl p-3 bg-amber-500/5">
              <button
                type="button"
                onClick={() => setShowChangeDateSection(!showChangeDateSection)}
                className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors w-full text-left">
                <Calendar className="w-4 h-4" />
                Cambiar fecha de actividad
                <span className="ml-auto text-xs text-foreground/40">{showChangeDateSection ? "▲ Ocultar" : "▼ Expandir"}</span>
              </button>
              {showChangeDateSection && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-foreground/60 mb-1.5">Nueva fecha de actividad *</label>
                    <input
                      type="date"
                      value={editResNewDate}
                      onChange={(e) => setEditResNewDate(e.target.value)}
                      className="w-full bg-foreground/[0.05] border border-foreground/[0.12] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-foreground/60 mb-1.5">Motivo del cambio * (obligatorio)</label>
                    <textarea
                      value={editResDateReason}
                      onChange={(e) => setEditResDateReason(e.target.value)}
                      rows={2}
                      placeholder="Ej: Solicitud del cliente por condiciones meteorológicas..."
                      className="w-full bg-foreground/[0.05] border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50 resize-none" />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => editResId !== null && changeDateMutation.mutate({ id: editResId, newDate: editResNewDate, reason: editResDateReason })}
                    disabled={changeDateMutation.isPending || !editResNewDate || editResDateReason.trim().length < 3}
                    className="bg-amber-600 hover:bg-amber-700 text-white w-full">
                    {changeDateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Calendar className="w-4 h-4 mr-1" />}
                    Confirmar cambio de fecha
                  </Button>
                </div>
              )}
            </div>

          </div>

          <DialogFooter className="flex-wrap gap-2 pt-2">
            {/* Descargar PDF */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => editResId !== null && downloadResPdfMutation.mutate({ id: editResId })}
              disabled={downloadResPdfMutation.isPending}
              className="border-sky-500/30 text-sky-400 hover:bg-sky-500/10">
              {downloadResPdfMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FileDown className="w-4 h-4 mr-1" />}
              Descargar reserva PDF
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
              <Button
                size="sm"
                onClick={() => {
                  if (editResId === null) return;
                  // Guardar estados separados si se han cambiado
                  if (editResStatusReservation || editResStatusPayment) {
                    updateStatusesMutation.mutate({
                      id: editResId,
                      statusReservation: editResStatusReservation as any || undefined,
                      statusPayment: editResStatusPayment as any || undefined,
                    });
                  }
                  // Guardar campos generales
                  updateResMutation.mutate({
                    id: editResId,
                    status: editResStatus as any || undefined,
                    notes: editResNotes || undefined,
                    channel: editResChannel || undefined,
                    channelDetail: editResChannelDetail || undefined,
                  });
                }}
                disabled={updateResMutation.isPending || updateStatusesMutation.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white">
                {(updateResMutation.isPending || updateStatusesMutation.isPending) ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Pencil className="w-4 h-4 mr-1" />}
                Guardar cambios
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── ELIMINAR RESERVA ───────────────────────────────────────────────── */}
      <Dialog open={deleteResId !== null} onOpenChange={(o) => !o && setDeleteResId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar reserva
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground/65 py-2">Esta acción es irreversible. Se eliminará la reserva y sus datos asociados. Las facturas generadas no se eliminarán.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteResId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => deleteResId !== null && deleteResMutation.mutate({ id: deleteResId })}
              disabled={deleteResMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white">
              {deleteResMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar reserva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Diálogo: Generar Factura desde reserva ──────────────────────────── */}
      <Dialog open={genInvoiceResId !== null} onOpenChange={(o) => { if (!o) { setGenInvoiceResId(null); setGenInvoiceNif(""); setGenInvoiceAddress(""); } }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FilePlus className="w-5 h-5 text-violet-400" /> Generar factura
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-foreground/65">Se generará una factura formal a partir de los datos de la reserva.</p>
            <div className="space-y-2">
              <Label className="text-foreground/70 text-xs">NIF / DNI del cliente (opcional)</Label>
              <Input
                value={genInvoiceNif}
                onChange={(e) => setGenInvoiceNif(e.target.value)}
                placeholder="12345678A"
                className="bg-foreground/[0.05] border-foreground/[0.15] text-white text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-foreground/70 text-xs">Dirección de facturación (opcional)</Label>
              <Input
                value={genInvoiceAddress}
                onChange={(e) => setGenInvoiceAddress(e.target.value)}
                placeholder="Calle, número, CP, ciudad"
                className="bg-foreground/[0.05] border-foreground/[0.15] text-white text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setGenInvoiceResId(null); setGenInvoiceNif(""); setGenInvoiceAddress(""); }} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => genInvoiceResId !== null && generateInvoiceMutation.mutate({
                reservationId: genInvoiceResId,
                clientNif: genInvoiceNif || undefined,
                clientAddress: genInvoiceAddress || undefined,
              })}
              disabled={generateInvoiceMutation.isPending}
              className="bg-violet-600 hover:bg-violet-700 text-white">
              {generateInvoiceMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <FilePlus className="w-4 h-4 mr-1" />}
              Generar factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODALES DE ANULACIONES ──────────────────────────────────────────── */}
      {/* Modal detalle anulación */}
      {selectedAnulId !== null && (
        <CancellationDetailModal
          requestId={selectedAnulId}
          onClose={() => {
            setSelectedAnulId(null);
            utils.cancellations.listRequests.invalidate();
          }}
          onNavigateToReservation={(reservationId) => {
            setSelectedAnulId(null);
            handleTabChange("reservations");
            setViewResId(reservationId);
          }}
        />
      )}
      {/* Confirmar eliminación anulación */}
      <Dialog open={deleteAnulId !== null} onOpenChange={(o) => !o && setDeleteAnulId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle>Eliminar solicitud</DialogTitle>
          </DialogHeader>
          <p className="text-foreground/65 text-sm">¿Seguro que quieres eliminar esta solicitud de anulación? Esta acción no se puede deshacer.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteAnulId(null)} className="border-foreground/[0.12] text-foreground/65">
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => deleteAnulId && deleteAnulMutation.mutate({ id: deleteAnulId })}
              disabled={deleteAnulMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteAnulMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ─── MODAL: Anular reserva directa — paso 1: motivo ────────────────────── */}
      {cancelReservationId !== null && (
        <AnularReservaModal
          reservationId={cancelReservationId}
          reservationName={cancelReservationName}
          onClose={() => { setCancelReservationId(null); setCancelReservationName(""); }}
          onCreated={(requestId) => {
            setCancelReservationId(null);
            setCancelReservationName("");
            setCancelAutoAcceptAnulId(requestId);
          }}
        />
      )}
      {/* ─── MODAL: Anular reserva directa — paso 2: resolución (CancellationDetailModal) ── */}
      {cancelAutoAcceptAnulId !== null && (
        <CancellationDetailModal
          requestId={cancelAutoAcceptAnulId}
          autoOpenAccept
          onClose={() => {
            setCancelAutoAcceptAnulId(null);
            utils.crm.reservations.list.invalidate();
            utils.crm.reservations.counters.invalidate();
            utils.cancellations.listRequests.invalidate();
            utils.cancellations.getCounters.invalidate();
            utils.crm.invoices.listAll.invalidate();
          }}
          onNavigateToReservation={(reservationId) => {
            setCancelAutoAcceptAnulId(null);
            handleTabChange("reservations");
            setViewResId(reservationId);
          }}
        />
      )}

        </AdminLayout>
  );
}

// ─── MODAL: Anular Reserva — paso 1: motivo e inicio del expediente ──────────
function AnularReservaModal({
  reservationId,
  reservationName,
  onClose,
  onCreated,
}: {
  reservationId: number;
  reservationName: string;
  onClose: () => void;
  onCreated: (requestId: number) => void;
}) {
  const [reason, setReason] = useState<"meteorologicas" | "accidente" | "enfermedad" | "desistimiento" | "otra">("otra");
  const [reasonDetail, setReasonDetail] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const createMutation = trpc.cancellations.createManualRequest.useMutation({
    onSuccess: (data) => {
      toast.success("Expediente de anulación creado — completa la resolución");
      onCreated(data.requestId);
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSubmit = () => {
    createMutation.mutate({
      fullName: reservationName,
      activityDate: new Date().toISOString().split("T")[0],
      reason,
      reasonDetail: reasonDetail.trim() || undefined,
      adminNotes: adminNotes.trim() || undefined,
      linkedReservationId: reservationId,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[#111] border border-orange-500/30 rounded-2xl p-6 max-w-md w-full">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 bg-orange-500/10 rounded-full flex items-center justify-center flex-shrink-0">
            <XCircle className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold">Iniciar anulación</h2>
            <p className="text-gray-400 text-xs mt-0.5 truncate max-w-[280px]">{reservationName}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-500 hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl px-4 py-3 mb-5">
          <p className="text-blue-300 text-xs">
            Se creará un expediente de anulación. En el siguiente paso podrás revisar el desglose de la reserva,
            elegir si cancelar líneas específicas y configurar la compensación.
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">Motivo de la anulación</label>
            <Select value={reason} onValueChange={(v) => setReason(v as typeof reason)}>
              <SelectTrigger className="bg-[#1a1a1a] border-foreground/[0.12] text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meteorologicas">Condiciones meteorológicas</SelectItem>
                <SelectItem value="accidente">Accidente</SelectItem>
                <SelectItem value="enfermedad">Enfermedad</SelectItem>
                <SelectItem value="desistimiento">Desistimiento voluntario</SelectItem>
                <SelectItem value="otra">Otra</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">Detalle del motivo (opcional)</label>
            <textarea
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder="Explicación adicional..."
              rows={2}
              className="w-full bg-[#1a1a1a] border border-foreground/[0.12] rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-600 resize-none focus:outline-none focus:border-orange-500/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-gray-300 text-sm">Notas internas (opcional)</label>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Anotaciones para el expediente..."
              rows={2}
              className="w-full bg-[#1a1a1a] border border-foreground/[0.12] rounded-lg px-3 py-2 text-white text-sm placeholder:text-gray-600 resize-none focus:outline-none focus:border-foreground/[0.18]"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-foreground/[0.12] text-gray-400 text-sm hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="flex-1 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? "Creando expediente..." : "Continuar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BONOS MANAGER ───────────────────────────────────────────────────────────
function BonosManager({ onOpenCancellation, onOpenReservation }: { onOpenCancellation: (id: number) => void; onOpenReservation: (id: number) => void }) {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"all" | "generado" | "enviado" | "canjeado" | "caducado" | "anulado">("all");
  const [search, setSearch] = useState("");
  const [extendModal, setExtendModal] = useState<{ id: number; code: string; current: string | null } | null>(null);
  const [cancelModal, setCancelModal] = useState<{ id: number; code: string } | null>(null);
  const [viewModal, setViewModal] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; code: string } | null>(null);
  const [newExpiry, setNewExpiry] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const { data: kpis } = trpc.cancellations.getVoucherCounters.useQuery();
  const { data: vouchers, isLoading } = trpc.cancellations.listVouchers.useQuery({
    status: statusFilter,
    search: search || undefined,
  });

  const invalidate = () => {
    utils.cancellations.listVouchers.invalidate();
    utils.cancellations.getVoucherCounters.invalidate();
  };

  const resendMut = trpc.cancellations.resendVoucherEmail.useMutation({
    onSuccess: () => { toast.success("Email reenviado correctamente"); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const extendMut = trpc.cancellations.extendVoucherExpiry.useMutation({
    onSuccess: () => { toast.success("Caducidad ampliada"); setExtendModal(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const cancelMut = trpc.cancellations.cancelVoucher.useMutation({
    onSuccess: () => { toast.success("Bono anulado"); setCancelModal(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.cancellations.deleteVoucher.useMutation({
    onSuccess: () => { toast.success("Bono eliminado"); setDeleteConfirm(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const { data: voucherDetail } = trpc.cancellations.getVoucherById.useQuery(
    { id: viewModal! },
    { enabled: !!viewModal }
  );

  const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
    generado:  { label: "Generado",  cls: "bg-blue-500/10 text-blue-300 border-blue-500/20" },
    enviado:   { label: "Activo",    cls: "bg-green-500/10 text-green-300 border-green-500/20" },
    canjeado:  { label: "Canjeado",  cls: "bg-purple-500/10 text-purple-300 border-purple-500/20" },
    caducado:  { label: "Caducado",  cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
    anulado:   { label: "Anulado",   cls: "bg-gray-500/10 text-gray-400 border-gray-500/20" },
  };

  const filters: { key: typeof statusFilter; label: string }[] = [
    { key: "all",      label: "Todos" },
    { key: "enviado",  label: "Activos" },
    { key: "canjeado", label: "Canjeados" },
    { key: "caducado", label: "Caducados" },
    { key: "anulado",  label: "Anulados" },
  ];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total emitidos", value: kpis?.total ?? 0, cls: "border-foreground/[0.08]" },
          { label: "Activos",        value: kpis?.activos ?? 0, cls: "border-green-500/20" },
          { label: "Canjeados",      value: kpis?.canjeados ?? 0, cls: "border-purple-500/20" },
          { label: "Caducados",      value: kpis?.caducados ?? 0, cls: "border-amber-500/20" },
          { label: "Importe pend.", value: `${(kpis?.importePendiente ?? 0).toFixed(2)} €`, cls: "border-green-500/20" },
        ].map(({ label, value, cls }) => (
          <div key={label} className={`bg-foreground/[0.03] border ${cls} rounded-xl p-4`}>
            <p className="text-foreground/50 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className="text-xl font-bold text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {/* Filtros + búsqueda */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 bg-foreground/[0.05] rounded-lg p-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${statusFilter === f.key ? "bg-purple-600 text-white" : "text-foreground/50 hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Código, cliente, expediente..."
            className="pl-8 h-8 bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-foreground/40 text-xs"
          />
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Código</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Valor</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Generado</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Reserva</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Anulación</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Caduca</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12 text-foreground/40"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : !vouchers || vouchers.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-foreground/40 text-sm">No se encontraron bonos</td></tr>
              ) : vouchers.map((v) => {
                const isActive = v.status === "enviado" || v.status === "generado";
                const badge = STATUS_BADGE[v.status] ?? STATUS_BADGE.generado;
                const isExpired = v.expiresAt && new Date(v.expiresAt) < new Date();
                return (
                  <tr key={v.id} className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors last:border-0">
                    {/* Código */}
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-sm text-purple-300">{v.code}</span>
                      {v.activityName && <p className="text-foreground/40 text-xs mt-0.5 truncate max-w-[160px]">{v.activityName}</p>}
                    </td>

                    {/* Cliente */}
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{v.clientName ?? "—"}</p>
                      {v.clientEmail && <p className="text-foreground/40 text-xs">{v.clientEmail}</p>}
                    </td>

                    {/* Valor */}
                    <td className="px-4 py-3">
                      <span className="text-orange-400 font-bold font-mono">{Number(v.value).toFixed(2)} €</span>
                      {v.redeemedAt && (
                        <p className="text-purple-300/60 text-xs mt-0.5">
                          Canjeado {new Date(v.redeemedAt).toLocaleDateString("es-ES")}
                        </p>
                      )}
                    </td>

                    {/* Generado */}
                    <td className="px-4 py-3 text-foreground/55 text-xs">
                      {v.issuedAt ? new Date(v.issuedAt).toLocaleDateString("es-ES") : "—"}
                    </td>

                    {/* Reserva */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {v.linkedReservationId && v.reservationNumber ? (
                        <button
                          onClick={() => onOpenReservation(v.linkedReservationId!)}
                          className="font-mono text-xs text-orange-400 hover:text-orange-300 hover:underline transition-colors"
                          title="Ver reserva"
                        >
                          {v.reservationNumber}
                        </button>
                      ) : (
                        <span className="text-foreground/25 text-xs">—</span>
                      )}
                    </td>

                    {/* Anulación */}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {v.cancellationNumber && v.requestId ? (
                        <button
                          onClick={() => onOpenCancellation(v.requestId)}
                          className="font-mono text-xs text-amber-400/80 hover:text-amber-300 hover:underline transition-colors"
                          title="Ver expediente de anulación"
                        >
                          {v.cancellationNumber}
                        </button>
                      ) : (
                        <span className="text-foreground/25 text-xs">—</span>
                      )}
                    </td>

                    {/* Caduca */}
                    <td className="px-4 py-3">
                      {v.expiresAt ? (
                        <span className={`text-xs font-medium ${isExpired && isActive ? "text-red-400" : "text-foreground/55"}`}>
                          {isExpired && isActive && "⚠ "}{new Date(v.expiresAt).toLocaleDateString("es-ES")}
                        </span>
                      ) : (
                        <span className="text-foreground/25 text-xs italic">Sin límite</span>
                      )}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center border rounded-full px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    {/* Acciones */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Ver detalle */}
                        <button
                          onClick={() => setViewModal(v.id)}
                          className="p-1.5 rounded-lg text-foreground/40 hover:text-purple-300 hover:bg-purple-500/10 transition-colors"
                          title="Ver detalle del bono"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {isActive && (
                          <button
                            onClick={() => resendMut.mutate({ voucherId: v.id })}
                            disabled={resendMut.isPending}
                            className="p-1.5 rounded-lg text-sky-400/60 hover:text-sky-300 hover:bg-sky-500/10 transition-colors"
                            title="Reenviar email al cliente"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {(isActive || v.status === "caducado") && (
                          <button
                            onClick={() => {
                              setNewExpiry(v.expiresAt ? new Date(v.expiresAt).toISOString().split("T")[0] : "");
                              setExtendModal({ id: v.id, code: v.code, current: v.expiresAt ? new Date(v.expiresAt).toLocaleDateString("es-ES") : null });
                            }}
                            className="p-1.5 rounded-lg text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                            title="Ampliar fecha de caducidad"
                          >
                            <CalendarClock className="w-4 h-4" />
                          </button>
                        )}
                        {v.status !== "canjeado" && v.status !== "anulado" && (
                          <button
                            onClick={() => { setCancelReason(""); setCancelModal({ id: v.id, code: v.code }); }}
                            className="p-1.5 rounded-lg text-foreground/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Anular bono"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        {/* Borrar */}
                        {v.status !== "canjeado" && (
                          <button
                            onClick={() => setDeleteConfirm({ id: v.id, code: v.code })}
                            className="p-1.5 rounded-lg text-foreground/25 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Eliminar bono permanentemente"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Ampliar caducidad */}
      <Dialog open={!!extendModal} onOpenChange={(o) => !o && setExtendModal(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <CalendarClock className="w-4 h-4 text-amber-400" /> Ampliar caducidad
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-foreground/60">Bono <span className="font-mono text-purple-300">{extendModal?.code}</span></p>
            {extendModal?.current && (
              <p className="text-xs text-foreground/50">Caducidad actual: <span className="text-amber-300">{extendModal.current}</span></p>
            )}
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">Nueva fecha de caducidad</Label>
              <Input
                type="date"
                value={newExpiry}
                onChange={(e) => setNewExpiry(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setExtendModal(null)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!newExpiry || extendMut.isPending}
              onClick={() => extendModal && extendMut.mutate({ voucherId: extendModal.id, newExpiresAt: newExpiry })}
            >
              {extendMut.isPending ? "Guardando..." : "Confirmar nueva fecha"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Anular bono */}
      <Dialog open={!!cancelModal} onOpenChange={(o) => !o && setCancelModal(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Ban className="w-4 h-4 text-red-400" /> Anular bono
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-foreground/70">
              ¿Confirmas anular el bono <span className="font-mono text-purple-300">{cancelModal?.code}</span>?
              El código quedará inactivo y el cliente no podrá usarlo.
            </p>
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">Motivo (opcional)</Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej: Emitido por error, cliente solicitó devolución económica..."
                rows={3}
                className="bg-foreground/[0.05] border-foreground/[0.12] text-white placeholder:text-gray-600 resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setCancelModal(null)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={cancelMut.isPending}
              onClick={() => cancelModal && cancelMut.mutate({ voucherId: cancelModal.id, reason: cancelReason || undefined })}
            >
              {cancelMut.isPending ? "Anulando..." : "Confirmar anulación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Ver detalle del bono */}
      <Dialog open={!!viewModal} onOpenChange={(o) => !o && setViewModal(null)}>
        <DialogContent className="max-w-lg bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Eye className="w-4 h-4 text-purple-400" /> Detalle del bono
            </DialogTitle>
          </DialogHeader>
          {voucherDetail ? (
            <div className="space-y-4 py-1">
              {/* Código y estado */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-xl font-bold text-purple-300">{voucherDetail.code}</span>
                <span className={`inline-flex items-center border rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  voucherDetail.status === "enviado" ? "bg-green-500/10 text-green-300 border-green-500/20" :
                  voucherDetail.status === "canjeado" ? "bg-purple-500/10 text-purple-300 border-purple-500/20" :
                  voucherDetail.status === "caducado" ? "bg-amber-500/10 text-amber-300 border-amber-500/20" :
                  voucherDetail.status === "anulado" ? "bg-gray-500/10 text-gray-400 border-gray-500/20" :
                  "bg-blue-500/10 text-blue-300 border-blue-500/20"
                }`}>
                  {voucherDetail.status === "enviado" ? "Activo" : voucherDetail.status.charAt(0).toUpperCase() + voucherDetail.status.slice(1)}
                </span>
              </div>

              {/* Valor + actividad */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/50">Valor</span>
                  <span className="text-orange-400 font-bold font-mono">{Number(voucherDetail.value).toFixed(2)} €</span>
                </div>
                {voucherDetail.activityName && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Actividad</span>
                    <span className="text-foreground/80 text-right max-w-[260px] truncate">{voucherDetail.activityName}</span>
                  </div>
                )}
              </div>

              {/* Cliente */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">Cliente</p>
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/50">Nombre</span>
                  <span className="text-white">{voucherDetail.clientName ?? "—"}</span>
                </div>
                {voucherDetail.clientEmail && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Email</span>
                    <span className="text-foreground/80">{voucherDetail.clientEmail}</span>
                  </div>
                )}
                {voucherDetail.clientPhone && (
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/50">Teléfono</span>
                    <span className="text-foreground/80">{voucherDetail.clientPhone}</span>
                  </div>
                )}
              </div>

              {/* Fechas */}
              <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">Fechas</p>
                {[
                  { label: "Generado", val: voucherDetail.issuedAt },
                  { label: "Enviado", val: voucherDetail.sentAt },
                  { label: "Caduca", val: voucherDetail.expiresAt },
                  { label: "Canjeado", val: voucherDetail.redeemedAt },
                ].map(({ label, val }) => val && (
                  <div key={label} className="flex justify-between text-sm">
                    <span className="text-foreground/50">{label}</span>
                    <span className="text-foreground/80">{new Date(val).toLocaleDateString("es-ES")}</span>
                  </div>
                ))}
              </div>

              {/* Vínculos */}
              {(voucherDetail.cancellationNumber || voucherDetail.reservationNumber) && (
                <div className="bg-foreground/[0.05] rounded-xl p-3 space-y-1">
                  <p className="text-xs text-foreground/40 uppercase tracking-wide mb-2">Vínculos</p>
                  {voucherDetail.cancellationNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">Anulación</span>
                      <button onClick={() => { setViewModal(null); onOpenCancellation(voucherDetail.requestId!); }} className="font-mono text-amber-400 hover:underline">{voucherDetail.cancellationNumber}</button>
                    </div>
                  )}
                  {voucherDetail.reservationNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground/50">Reserva</span>
                      <button onClick={() => { setViewModal(null); onOpenReservation(voucherDetail.linkedReservationId!); }} className="font-mono text-orange-400 hover:underline">{voucherDetail.reservationNumber}</button>
                    </div>
                  )}
                </div>
              )}

              {voucherDetail.notes && (
                <div className="bg-foreground/[0.05] rounded-xl p-3">
                  <p className="text-xs text-foreground/40 uppercase tracking-wide mb-1">Notas</p>
                  <p className="text-sm text-foreground/70">{voucherDetail.notes}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 flex justify-center"><RefreshCw className="w-5 h-5 animate-spin text-foreground/40" /></div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setViewModal(null)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Eliminar bono */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Trash2 className="w-4 h-4 text-red-500" /> Eliminar bono
            </DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-foreground/70">
              ¿Eliminar permanentemente el bono <span className="font-mono text-purple-300">{deleteConfirm?.code}</span>?
            </p>
            <p className="text-xs text-red-400/70 mt-2">Esta acción no se puede deshacer.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="border-foreground/[0.15] text-foreground/65" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleteMut.isPending}
              onClick={() => deleteConfirm && deleteMut.mutate({ id: deleteConfirm.id })}
            >
              {deleteMut.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── PAGOS PENDIENTES TAB ────────────────────────────────────────────────────
function PagosPendientesTab() {
  const utils = trpc.useUtils();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<"transferencia" | "efectivo" | "tarjeta_fisica">("transferencia");
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, isLoading, refetch } = trpc.crm.pendingPayments.list.useQuery({
    status: filterStatus === "all" ? undefined : filterStatus as "pending" | "paid" | "cancelled" | "incidentado",
    limit: 50,
    offset: 0,
  });

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;

  const confirmMut = trpc.crm.pendingPayments.confirm.useMutation({
    onSuccess: () => {
      toast.success("Pago confirmado correctamente");
      setConfirmId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const resendMut = trpc.crm.pendingPayments.resendReminder.useMutation({
    onSuccess: () => toast.success("Email de recordatorio enviado"),
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const cancelMut = trpc.crm.pendingPayments.cancel.useMutation({
    onSuccess: () => {
      toast.success("Pago pendiente cancelado");
      setCancelId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = trpc.crm.pendingPayments.delete.useMutation({
    onSuccess: () => {
      toast.success("Registro eliminado");
      setDeleteId(null);
      utils.crm.pendingPayments.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      pending:   { label: "Pendiente",  cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
      overdue:   { label: "Vencido",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
      confirmed: { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
      cancelled: { label: "Cancelado",  cls: "bg-foreground/[0.08] text-foreground/50 border-foreground/[0.12]" },
    };
    const s = map[status] ?? { label: status, cls: "bg-foreground/[0.08] text-foreground/50 border-foreground/[0.12]" };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium ${s.cls}`}>
        {s.label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-lg">Pagos Pendientes</h2>
          <p className="text-foreground/50 text-sm">{total} registro{total !== 1 ? "s" : ""} en total</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
              <SelectItem value="all" className="text-white text-xs">Todos</SelectItem>
              <SelectItem value="pending" className="text-white text-xs">Pendiente</SelectItem>
              <SelectItem value="overdue" className="text-white text-xs">Vencido</SelectItem>
              <SelectItem value="confirmed" className="text-white text-xs">Confirmado</SelectItem>
              <SelectItem value="cancelled" className="text-white text-xs">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg bg-foreground/[0.05] hover:bg-foreground/[0.08] text-foreground/50 hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-foreground/[0.10] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/[0.10] bg-foreground/[0.05]">
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">#</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Presupuesto</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Importe</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Vencimiento</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Motivo</th>
                <th className="text-left px-4 py-3 text-xs text-foreground/50 font-medium">Estado</th>
                <th className="text-right px-4 py-3 text-xs text-foreground/50 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-foreground/40">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <Clock className="w-8 h-8 text-foreground/30 mx-auto mb-2" />
                    <p className="text-foreground/40 text-sm">No hay pagos pendientes</p>
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const dueDate = row.dueDate ? new Date(row.dueDate) : null;
                const isOverdue = dueDate && dueDate < new Date() && row.status === "pending";
                return (
                  <tr
                    key={row.id}
                    className="border-b border-foreground/[0.08] hover:bg-foreground/[0.03] transition-colors"
                  >
                    <td className="px-4 py-3 text-foreground/50 text-sm font-mono">#{row.id}</td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{row.clientName}</p>
                      {row.clientEmail && <p className="text-foreground/50 text-xs">{row.clientEmail}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {row.quoteId ? (
                        <span className="text-foreground/65 text-xs font-mono">PRES-{row.quoteId}</span>
                      ) : (
                        <span className="text-foreground/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold text-sm">
                        {(row.amountCents / 100).toFixed(2)} €
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {dueDate ? (
                        <span className={`text-xs ${isOverdue ? "text-red-400 font-semibold" : "text-foreground/65"}`}>
                          {dueDate.toLocaleDateString("es-ES")}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-foreground/30 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground/60 text-xs max-w-[160px] truncate">
                      {row.reason ?? "—"}
                    </td>
                    <td className="px-4 py-3">{statusBadge(row.status)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {row.status === "pending" && (
                          <>
                            <button
                              onClick={() => { setConfirmId(row.id); setConfirmMethod("transferencia"); }}
                              title="Confirmar pago"
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => resendMut.mutate({ id: row.id })}
                              title="Reenviar recordatorio"
                              className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 transition-colors"
                              disabled={resendMut.isPending}
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setCancelId(row.id)}
                              title="Cancelar"
                              className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setDeleteId(row.id)}
                          title="Eliminar registro"
                          className="p-1.5 rounded-lg bg-foreground/[0.05] hover:bg-red-500/20 text-foreground/30 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm payment modal */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-foreground/65 text-xs mb-1.5 block">Método de pago</Label>
              <Select value={confirmMethod} onValueChange={(v) => setConfirmMethod(v as any)}>
                <SelectTrigger className="bg-foreground/[0.05] border-foreground/[0.12] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-foreground/[0.12]">
                  <SelectItem value="transferencia" className="text-white">🏦 Transferencia bancaria</SelectItem>
                  <SelectItem value="tarjeta_fisica" className="text-white">💳 Tarjeta Física</SelectItem>
                  <SelectItem value="efectivo" className="text-white">💵 Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-foreground/50">Se marcará el pago como confirmado y se actualizará la reserva asociada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => confirmId !== null && confirmMut.mutate({ id: confirmId, paymentMethod: confirmMethod })}
              disabled={confirmMut.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {confirmMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Confirmar cobro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel modal */}
      <Dialog open={cancelId !== null} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Cancelar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <p className="text-foreground/65 text-sm py-2">¿Seguro que quieres cancelar este pago pendiente? El cliente no recibirá más recordatorios.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelId(null)} className="border-foreground/[0.15] text-foreground/65">Volver</Button>
            <Button
              size="sm"
              onClick={() => cancelId !== null && cancelMut.mutate({ id: cancelId })}
              disabled={cancelMut.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
              Cancelar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete modal */}
      <Dialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-foreground/[0.12] text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" /> Eliminar registro
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-foreground/65 text-sm">Esta acción eliminará el registro de forma permanente y no se puede deshacer.</p>
            <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              Solo elimina el registro de pago pendiente. La reserva y el presupuesto asociados no se modifican.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteId(null)} className="border-foreground/[0.15] text-foreground/65">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => deleteId !== null && deleteMut.mutate({ id: deleteId })}
              disabled={deleteMut.isPending}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {deleteMut.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
