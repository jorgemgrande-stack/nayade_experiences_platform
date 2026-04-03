import React, { useState, useMemo, useEffect, useRef } from "react";
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
import {
  Users,
  User,
  FileText,
  CalendarCheck,
  Calendar,
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
} from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Tab = "leads" | "quotes" | "reservations" | "invoices" | "anulaciones" | "pagos_pendientes";

type OpportunityStatus = "nueva" | "enviada" | "ganada" | "perdida";
type Priority = "baja" | "media" | "alta";
type QuoteStatus = "borrador" | "enviado" | "aceptado" | "rechazado" | "expirado" | "perdido";

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
    borrador: { label: "Borrador", className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
    enviado: { label: "Enviado", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    aceptado: { label: "Aceptado", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    rechazado: { label: "Rechazado", className: "bg-red-500/15 text-red-400 border-red-500/30" },
    expirado: { label: "Expirado", className: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    perdido: { label: "Perdido", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const { label, className } = map[status] ?? map.borrador;
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
    bg: "bg-gradient-to-br from-blue-950/80 via-blue-900/40 to-[#080e1c]",
    border: "border-blue-500/30",
    activeBorder: "border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.35)]",
    glow: "bg-blue-500/10",
    icon: "text-blue-400",
    number: "text-blue-300",
    label: "text-blue-300/70",
    dot: "bg-blue-400",
  },
  amber: {
    bg: "bg-gradient-to-br from-amber-950/80 via-amber-900/30 to-[#080e1c]",
    border: "border-amber-500/30",
    activeBorder: "border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.35)]",
    glow: "bg-amber-500/10",
    icon: "text-amber-400",
    number: "text-amber-300",
    label: "text-amber-300/70",
    dot: "bg-amber-400",
  },
  green: {
    bg: "bg-gradient-to-br from-emerald-950/80 via-emerald-900/30 to-[#080e1c]",
    border: "border-emerald-500/30",
    activeBorder: "border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.35)]",
    glow: "bg-emerald-500/10",
    icon: "text-emerald-400",
    number: "text-emerald-300",
    label: "text-emerald-300/70",
    dot: "bg-emerald-400",
  },
  red: {
    bg: "bg-gradient-to-br from-red-950/80 via-red-900/30 to-[#080e1c]",
    border: "border-red-500/30",
    activeBorder: "border-red-400 shadow-[0_0_20px_rgba(239,68,68,0.35)]",
    glow: "bg-red-500/10",
    icon: "text-red-400",
    number: "text-red-300",
    label: "text-red-300/70",
    dot: "bg-red-400",
  },
  slate: {
    bg: "bg-gradient-to-br from-slate-800/80 via-slate-700/30 to-[#080e1c]",
    border: "border-slate-500/30",
    activeBorder: "border-slate-400 shadow-[0_0_20px_rgba(148,163,184,0.25)]",
    glow: "bg-slate-500/10",
    icon: "text-slate-400",
    number: "text-slate-300",
    label: "text-slate-300/70",
    dot: "bg-slate-400",
  },
  orange: {
    bg: "bg-gradient-to-br from-orange-950/80 via-orange-900/30 to-[#080e1c]",
    border: "border-orange-500/30",
    activeBorder: "border-orange-400 shadow-[0_0_20px_rgba(249,115,22,0.35)]",
    glow: "bg-orange-500/10",
    icon: "text-orange-400",
    number: "text-orange-300",
    label: "text-orange-300/70",
    dot: "bg-orange-400",
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
  const s = map[status] ?? { label: status, cls: "bg-white/5 text-white/40 border-white/10" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}
function AnulResBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sin_resolver: { label: "Sin resolver", cls: "bg-white/5 text-white/40 border-white/10" },
    rechazada: { label: "Rechazada", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
    aceptada_total: { label: "Aceptada total", cls: "bg-green-500/15 text-green-300 border-green-500/20" },
    aceptada_parcial: { label: "Aceptada parcial", cls: "bg-teal-500/15 text-teal-300 border-teal-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/5 text-white/40 border-white/10" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}
function AnulFinBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    sin_compensacion: { label: "Sin comp.", cls: "bg-white/5 text-white/40 border-white/10" },
    pendiente_devolucion: { label: "Pend. dev.", cls: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
    devuelta_economicamente: { label: "Devuelta", cls: "bg-green-500/15 text-green-300 border-green-500/20" },
    pendiente_bono: { label: "Pend. bono", cls: "bg-purple-500/15 text-purple-300 border-purple-500/20" },
    compensada_bono: { label: "Bono enviado", cls: "bg-violet-500/15 text-violet-300 border-violet-500/20" },
    incidencia_economica: { label: "Incid. ec.", cls: "bg-red-500/15 text-red-300 border-red-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/5 text-white/40 border-white/10" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
}

function CounterCard({
  label,
  value,
  icon: Icon,
  active,
  onClick,
  color = "blue",
  subtitle,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  active?: boolean;
  onClick?: () => void;
  color?: keyof typeof COUNTER_STYLES;
  subtitle?: string;
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

      {/* Number */}
      <div className="relative z-10">
        <span className={`text-2xl font-black tabular-nums tracking-tight ${s.number}`}>
          {numericValue !== null ? animated : displayValue}
        </span>
        {subtitle && <p className={`text-[10px] mt-0.5 ${s.label}`}>{subtitle}</p>}
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
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
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
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 text-white">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center font-bold text-sm">
            {lead.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-bold">{lead.name}</div>
            <div className="text-sm text-white/50 font-normal">{lead.email}</div>
          </div>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* Status & Priority */}
        <div className="flex items-center gap-3 flex-wrap">
          <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
          <PriorityDot priority={lead.priority as Priority} />
          <span className="text-xs text-white/40 capitalize">{lead.priority} prioridad</span>
          <span className="text-xs text-white/30">·</span>
          <span className="text-xs text-white/40">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</span>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-2 gap-3">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-white/70 hover:text-orange-400 transition-colors">
              <Phone className="w-3.5 h-3.5" /> {lead.phone}
            </a>
          )}
          <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-white/70 hover:text-orange-400 transition-colors">
            <Mail className="w-3.5 h-3.5" /> {lead.email}
          </a>
        </div>

        {/* Request details */}
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          {lead.selectedCategory && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Categoría</span>
              <span className="text-white font-medium">{lead.selectedCategory}</span>
            </div>
          )}
          {lead.selectedProduct && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Producto</span>
              <span className="text-white font-medium">{lead.selectedProduct}</span>
            </div>
          )}
          {lead.preferredDate && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Fecha de la actividad</span>
              <span className="text-white font-medium">{new Date(lead.preferredDate).toLocaleDateString("es-ES")}</span>
            </div>
          )}
          {(lead.numberOfAdults || lead.numberOfPersons) && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Personas</span>
              <span className="text-white font-medium">
                {lead.numberOfAdults ? `${lead.numberOfAdults} adultos` : ""}{lead.numberOfChildren ? ` + ${lead.numberOfChildren} niños` : ""}
                {!lead.numberOfAdults && lead.numberOfPersons ? `${lead.numberOfPersons} personas` : ""}
              </span>
            </div>
          )}
          {/* Actividades enriquecidas desde el formulario multi-actividad */}
          {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 && (
            <div className="pt-2 border-t border-white/10">
              <p className="text-xs text-white/40 uppercase tracking-wider mb-2">Actividades solicitadas</p>
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
            <div className="pt-2 border-t border-white/10">
              <p className="text-sm text-white/60 italic">"{lead.message}"</p>
            </div>
          )}
        </div>

        {/* Related quotes */}
        {relatedQuotes.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Presupuestos asociados</h4>
            <div className="space-y-2">
              {relatedQuotes.map((q: any) => (
                <div key={q.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-white">{q.quoteNumber}</span>
                    <span className="text-xs text-white/40 ml-2">{q.title}</span>
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
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Notas internas</h4>
          {Array.isArray(lead.internalNotes) && lead.internalNotes.length > 0 ? (
            <div className="space-y-2 mb-3">
              {(lead.internalNotes as { text: string; authorName: string; createdAt: string }[]).map((n, i) => (
                <div key={i} className="bg-white/5 rounded-lg px-3 py-2">
                  <p className="text-sm text-white/80">{n.text}</p>
                  <p className="text-xs text-white/30 mt-1">{n.authorName} · {new Date(n.createdAt).toLocaleString("es-ES")}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/30 mb-3">Sin notas aún</p>
          )}
          <div className="flex gap-2">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Añadir nota interna..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none h-16"
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
          <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Cambiar estado</h4>
          <div className="flex gap-2 flex-wrap">
            {(["nueva", "enviada", "ganada", "perdida"] as OpportunityStatus[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant="outline"
                className={`border-white/15 text-white/70 hover:text-white text-xs capitalize ${lead.opportunityStatus === s ? "bg-white/10 text-white" : ""}`}
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
      <DialogContent className="max-w-xl bg-[#0d1526] border-white/10 text-white">
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
    <DialogContent className="max-w-xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Pencil className="w-4 h-4 text-orange-400" /> Editar Lead
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-white/60 text-xs">Nombre <span className="text-red-400">*</span></Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Email <span className="text-red-400">*</span></Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Teléfono</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Empresa / Grupo</Label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
        </div>

        {/* Líneas de actividad */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-white/60 text-xs">Actividades de interés</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-orange-400 hover:text-orange-300 transition-colors">
              <Plus className="w-3 h-3" /> Añadir actividad
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30 w-4">{idx + 1}.</span>
                  <div className="relative flex-1">
                    <Input
                      value={line.experienceTitle || line.search}
                      onChange={e => { updateLine(idx, { search: e.target.value, experienceTitle: "", experienceId: null }); setActiveLineIdx(idx); }}
                      onFocus={() => { updateLine(idx, { showSuggestions: true }); setActiveLineIdx(idx); }}
                      onBlur={() => setTimeout(() => updateLine(idx, { showSuggestions: false }), 200)}
                      placeholder="Buscar experiencia o pack..."
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm h-8"
                    />
                    {line.showSuggestions && productSuggestions && productSuggestions.length > 0 && activeLineIdx === idx && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/15 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                        {(productSuggestions as any[]).map((p: any) => (
                          <button key={`${p.productType}-${p.id}`} type="button"
                            className="w-full text-left px-3 py-2 hover:bg-white/8 text-xs text-white flex items-center gap-2"
                            onMouseDown={() => updateLine(idx, {
                              experienceId: p.id,
                              experienceTitle: p.title,
                              family: p.productType === "experience" ? "experience" : "pack",
                              search: "",
                              showSuggestions: false,
                            })}>
                            <span className="text-white/40">{p.productType === "experience" ? "🏊" : "📦"}</span>
                            <span>{p.title}</span>
                            {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-white/40">{Number(p.basePrice).toFixed(2)}€</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-white/40">Pax</span>
                    <Input
                      type="number" min={1} value={line.participants}
                      onChange={e => updateLine(idx, { participants: Math.max(1, Number(e.target.value)) })}
                      className="bg-white/5 border-white/10 text-white w-14 h-8 text-xs text-center"
                    />
                    {activityLines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-white/30 hover:text-red-400 transition-colors ml-1">
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
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-white/60 text-xs">Fecha de la actividad</Label>
            <Input type="date" value={form.preferredDate} onChange={e => setForm({ ...form, preferredDate: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Adultos</Label>
            <Input type="number" min={1} value={form.numberOfAdults} onChange={e => setForm({ ...form, numberOfAdults: Number(e.target.value) })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Niños</Label>
            <Input type="number" min={0} value={form.numberOfChildren} onChange={e => setForm({ ...form, numberOfChildren: Number(e.target.value) })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
        </div>

        {/* Prioridad y estado */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-white/60 text-xs">Prioridad</Label>
            <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
                <SelectItem value="baja" className="text-white">Baja</SelectItem>
                <SelectItem value="media" className="text-white">Media</SelectItem>
                <SelectItem value="alta" className="text-white">Alta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-white/60 text-xs">Estado oportunidad</Label>
            <Select value={form.opportunityStatus} onValueChange={(v) => setForm({ ...form, opportunityStatus: v })}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
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
          <Label className="text-white/60 text-xs">Mensaje / Comentarios</Label>
          <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1 resize-none h-16 text-sm" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
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
  onSelect: (product: { title: string; basePrice: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: products } = trpc.crm.products.search.useQuery(
    { q, limit: 10 },
    { enabled: open }
  );

  return (
    <div className="relative">
      <Input
        className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
        placeholder="Descripción o busca un producto..."
        value={value}
        onChange={(e) => { onChange(e.target.value); setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && products && products.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {products.map((p: any) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-white/10 text-sm text-white flex justify-between items-center gap-2"
              onMouseDown={() => { onSelect(p as any); setOpen(false); }}
            >
              <span className="truncate">{p.title}</span>
              <span className="text-orange-400 text-xs shrink-0">{Number(p.basePrice).toFixed(2)} €</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
    search: string;
    showSuggestions: boolean;
  };
  const [activityLines, setActivityLines] = useState<ActivityLine[]>([
    { id: "1", experienceId: null, experienceTitle: "", family: "", participants: 2, search: "", showSuggestions: false },
  ]);
  const [activeLineIdx, setActiveLineIdx] = useState<number>(0);

  const activeSearch = activityLines[activeLineIdx]?.search ?? "";
  const { data: productSuggestions } = trpc.crm.products.search.useQuery(
    { q: activeSearch, limit: 8 },
    { enabled: activeSearch.length >= 2 }
  );

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
      search: "",
      showSuggestions: false,
    }]);
    setActiveLineIdx(activityLines.length);
  };
  const removeLine = (idx: number) => {
    if (activityLines.length === 1) return;
    setActivityLines(prev => prev.filter((_, i) => i !== idx));
    setActiveLineIdx(Math.max(0, activeLineIdx - 1));
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
    <DialogContent className="max-w-xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-violet-400" /> Nuevo Lead
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {/* Datos del cliente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Nombre <span className="text-red-400">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ana García" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Email <span className="text-red-400">*</span></Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ana@ejemplo.com" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Teléfono</Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Empresa / Grupo</Label>
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Empresa S.L." className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
          </div>
        </div>

        {/* Líneas de actividad */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-xs text-white/50">Actividades de interés</Label>
            <button type="button" onClick={addLine} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
              <Plus className="w-3 h-3" /> Añadir actividad
            </button>
          </div>
          <div className="space-y-2">
            {activityLines.map((line, idx) => (
              <div key={line.id} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30 w-4">{idx + 1}.</span>
                  <div className="relative flex-1">
                    <Input
                      value={line.experienceTitle || line.search}
                      onChange={e => { updateLine(idx, { search: e.target.value, experienceTitle: "", experienceId: null }); setActiveLineIdx(idx); }}
                      onFocus={() => { updateLine(idx, { showSuggestions: true }); setActiveLineIdx(idx); }}
                      onBlur={() => setTimeout(() => updateLine(idx, { showSuggestions: false }), 200)}
                      placeholder="Buscar experiencia o pack..."
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/25 text-sm h-8"
                    />
                    {line.showSuggestions && productSuggestions && productSuggestions.length > 0 && activeLineIdx === idx && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/15 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                        {(productSuggestions as any[]).map((p: any) => (
                          <button key={`${p.productType}-${p.id}`} type="button"
                            className="w-full text-left px-3 py-2 hover:bg-white/8 text-xs text-white flex items-center gap-2"
                            onMouseDown={() => updateLine(idx, {
                              experienceId: p.id,
                              experienceTitle: p.title,
                              family: p.productType === "experience" ? "experience" : "pack",
                              search: "",
                              showSuggestions: false,
                            })}>
                            <span className="text-white/40">{p.productType === "experience" ? "🏊" : "📦"}</span>
                            <span>{p.title}</span>
                            {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-white/40">{Number(p.basePrice).toFixed(2)}€</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-xs text-white/40">Pax</span>
                    <Input
                      type="number" min={1} value={line.participants}
                      onChange={e => updateLine(idx, { participants: Math.max(1, Number(e.target.value)) })}
                      className="bg-white/5 border-white/10 text-white w-14 h-8 text-xs text-center"
                    />
                    {activityLines.length > 1 && (
                      <button type="button" onClick={() => removeLine(idx)} className="text-white/30 hover:text-red-400 transition-colors ml-1">
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

        {/* Fecha y participantes globales */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-xs text-white/50 mb-1 block">Fecha de la actividad</Label>
            <Input type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} className="bg-white/5 border-white/10 text-white" />
          </div>
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Adultos</Label>
            <Input type="number" min={1} value={adults} onChange={e => setAdults(Number(e.target.value))} className="bg-white/5 border-white/10 text-white" />
          </div>
          <div>
            <Label className="text-xs text-white/50 mb-1 block">Niños</Label>
            <Input type="number" min={0} value={children} onChange={e => setChildren(Number(e.target.value))} className="bg-white/5 border-white/10 text-white" />
          </div>
        </div>

        {/* Canal y notas */}
        <div>
          <Label className="text-xs text-white/50 mb-1 block">Canal de origen</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-white/10">
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
          <Label className="text-xs text-white/50 mb-1 block">Mensaje / notas</Label>
          <Textarea value={messageText} onChange={e => setMessageText(e.target.value)} placeholder="Información adicional del cliente..." rows={3} className="bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none" />
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
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
    <DialogContent className="max-w-xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-emerald-400" /> Nueva Reserva
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-2">
        {/* Cliente */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Cliente</p>
          <div className="relative">
            <Label className="text-xs text-white/50 mb-1 block">Nombre completo *</Label>
            <Input
              value={customerName || clientSearch}
              onChange={e => { setClientSearch(e.target.value); setCustomerName(""); setShowClientSugg(true); }}
              onFocus={() => setShowClientSugg(true)}
              placeholder="Buscar cliente existente o escribir nuevo..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25"
            />
            {showClientSugg && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/15 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {clientSuggestions.map((c) => (
                  <button key={c.id} type="button" className="w-full text-left px-3 py-2 hover:bg-white/8 text-sm text-white"
                    onClick={() => { setCustomerName(c.name); setCustomerEmail(c.email ?? ""); setCustomerPhone(c.phone ?? ""); setClientSearch(""); setShowClientSugg(false); }}>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-white/40 ml-2 text-xs">{c.email}</span>
                  </button>
                ))}
              </div>
            )}
            {customerName && <p className="text-xs text-emerald-400 mt-1">✓ {customerName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Email *</Label>
              <Input type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="cliente@email.com" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Teléfono</Label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="+34 600 000 000" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
            </div>
          </div>
        </div>
        {/* Producto */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Producto / Servicio</p>
          <div className="relative">
            <Label className="text-xs text-white/50 mb-1 block">Experiencia o pack *</Label>
            <Input
              value={productName || productSearch}
              onChange={e => { setProductSearch(e.target.value); setProductId(null); setProductName(""); setShowProductSugg(true); }}
              onFocus={() => setShowProductSugg(true)}
              placeholder="Buscar producto..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/25"
            />
            {showProductSugg && productSuggestions && (productSuggestions as any[]).length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/15 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                {(productSuggestions as any[]).map((p: any) => (
                  <button key={`${p.productType}-${p.id}`} type="button" className="w-full text-left px-3 py-2 hover:bg-white/8 text-sm text-white flex items-center gap-2"
                    onClick={() => {
                      setProductId(p.id); setProductName(p.title);
                      if (p.basePrice && Number(p.basePrice) > 0) { const base = Number(p.basePrice) * people; setAmountTotal(base.toFixed(2)); setAmountPaid(base.toFixed(2)); }
                      setProductSearch(""); setShowProductSugg(false);
                    }}>
                    <span className="text-white/40 text-xs">{p.productType === "experience" ? "🏊" : "📦"}</span>
                    <span>{p.title}</span>
                    {p.basePrice && Number(p.basePrice) > 0 && <span className="ml-auto text-white/40 text-xs">{Number(p.basePrice).toFixed(2)}€/pers</span>}
                  </button>
                ))}
              </div>
            )}
            {productName && <p className="text-xs text-emerald-400 mt-1">✓ {productName}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Fecha del servicio *</Label>
              <Input type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} className="bg-white/5 border-white/10 text-white" />
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Nº personas</Label>
              <Input type="number" min={1} value={people} onChange={e => setPeople(Number(e.target.value))} className="bg-white/5 border-white/10 text-white" />
            </div>
          </div>
        </div>
        {/* Económico */}
        <div className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Datos económicos</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Importe total (€) *</Label>
              <Input type="number" min={0} step="0.01" value={amountTotal} onChange={e => setAmountTotal(e.target.value)} placeholder="0.00" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Importe cobrado (€)</Label>
              <Input type="number" min={0} step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} placeholder="Igual al total si pagado" className="bg-white/5 border-white/10 text-white placeholder:text-white/25" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Método de pago</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as typeof paymentMethod)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-white/10">
                  <SelectItem value="efectivo" className="text-white text-xs">💵 Efectivo</SelectItem>
                  <SelectItem value="transferencia" className="text-white text-xs">🏦 Transferencia</SelectItem>
                  <SelectItem value="redsys" className="text-white text-xs">💳 Tarjeta (Redsys)</SelectItem>
                  <SelectItem value="otro" className="text-white text-xs">❓ Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-white/50 mb-1 block">Canal</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-white/10">
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
          <Label className="text-xs text-white/50 mb-1 block">Notas internas</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notas para el equipo..." rows={2} className="bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none" />
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={sendEmailConfirm} onChange={e => setSendEmailConfirm(e.target.checked)} className="rounded" />
          <span className="text-sm text-white/60">Enviar email de confirmación al cliente</span>
        </label>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
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
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]>([{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general_21" }]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
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
  const taxAmount = parseFloat((discountedGeneral * (taxRate / 100)).toFixed(2));
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

  const createDirect = trpc.crm.quotes.createDirect.useMutation({
    onSuccess: (data) => {
      toast.success(
        data.sent
          ? `Presupuesto ${data.quoteNumber} creado y enviado al cliente`
          : `Presupuesto ${data.quoteNumber} guardado como borrador`
      );
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
    setSendAfterCreate(andSend);
    createDirect.mutate({
      clientName,
      clientEmail,
      clientPhone: clientPhone || undefined,
      clientCompany: clientCompany || undefined,
      title,
      items,
      subtotal,
      discount: promoDiscount,
      taxRate,
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
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Plus className="w-5 h-5 text-orange-400" /> Nuevo Presupuesto
          <span className="text-white/40 text-sm font-normal ml-1">sin lead previo</span>
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-5">
        {/* ── Sección cliente ── */}
        <div className="bg-white/5 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <User className="w-4 h-4 text-orange-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-white/50">Datos del cliente</span>
          </div>

          {/* Buscador de cliente existente */}
          <div className="relative">
            <Label className="text-white/60 text-xs">Buscar cliente existente</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <Input
                className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
                placeholder="Nombre o email del cliente..."
                value={clientSearch}
                onChange={(e) => { setClientSearch(e.target.value); setShowClientSuggestions(true); }}
                onFocus={() => setShowClientSuggestions(true)}
                onBlur={() => setTimeout(() => setShowClientSuggestions(false), 200)}
              />
            </div>
            {showClientSuggestions && clientSuggestions.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {clientSuggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-white/10 flex items-center justify-between gap-2"
                    onMouseDown={() => selectClient(c)}
                  >
                    <div>
                      <div className="text-sm text-white font-medium">{c.name}</div>
                      <div className="text-xs text-white/40">{c.email}</div>
                    </div>
                    {c.company && <span className="text-xs text-white/30 shrink-0">{c.company}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="text-xs text-white/30 text-center">— o introduce los datos manualmente —</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-white/60 text-xs">Nombre *</Label>
              <Input value={clientName} onChange={(e) => { setClientName(e.target.value); setTitle(`Presupuesto Nayade Experiences - ${e.target.value}`); }}
                className="bg-white/5 border-white/10 text-white mt-1 text-sm" placeholder="Nombre completo" />
            </div>
            <div>
              <Label className="text-white/60 text-xs">Email *</Label>
              <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                className="bg-white/5 border-white/10 text-white mt-1 text-sm" placeholder="cliente@email.com" />
            </div>
            <div>
              <Label className="text-white/60 text-xs">Teléfono</Label>
              <Input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)}
                className="bg-white/5 border-white/10 text-white mt-1 text-sm" placeholder="+34 600 000 000" />
            </div>
            <div>
              <Label className="text-white/60 text-xs">Empresa</Label>
              <Input value={clientCompany} onChange={(e) => setClientCompany(e.target.value)}
                className="bg-white/5 border-white/10 text-white mt-1 text-sm" placeholder="Nombre empresa (opcional)" />
            </div>
          </div>
        </div>

        {/* ── Asunto y fechas ── */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Asunto del presupuesto *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1 text-sm" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Válido hasta</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
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
            <Label className="text-white/60 text-xs">Conceptos * <span className="text-white/30">(escribe o busca un producto)</span></Label>
            <Button size="sm" variant="ghost" className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}>
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="text-xs text-white/30 grid grid-cols-12 gap-2 mb-1">
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
                        const fr = (p as any).fiscalRegime === "reav" ? "reav" : "general_21";
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity, fiscalRegime: fr };
                      }));
                    }}
                  />
                </div>
                <select
                  className="col-span-2 bg-white/5 border border-white/10 text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime ?? "general_21"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: e.target.value as "reav" | "general_21" } : it))}
                >
                  <option value="general_21" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-amber-400" : "text-orange-400"}`}>{item.total.toFixed(2)} €</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-white/30 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Totales */}
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-white/60"><span>Subtotal rég. general</span><span>{generalSubtotal.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotal).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-white/60"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {generalSubtotal > 0 && (
            <div className="flex justify-between text-sm text-white/60"><span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span></div>
          )}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-2 mt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        <div>
          <Label className="text-white/60 text-xs">Notas para el cliente</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Información adicional visible para el cliente..."
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-white/60 text-xs">Condiciones</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)}
            className="bg-white/5 border-white/10 text-white mt-1 resize-none h-12 text-sm" />
        </div>
      </div>

      <DialogFooter className="gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
        <Button size="sm" onClick={() => handleSubmit(false)} disabled={createDirect.isPending}
          className="bg-white/10 hover:bg-white/20 text-white border border-white/15">
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
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]>([
    { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general_21" },
  ]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);
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
      setItems(result.data.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]);
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
  const taxAmount = parseFloat((discountedGeneral * (taxRate / 100)).toFixed(2));
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

  const convertToQuote = trpc.crm.leads.convertToQuote.useMutation({
    onSuccess: async (data) => {
      toast.success(`Presupuesto ${data.quoteNumber} creado`);
      utils.crm.leads.counters.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.quotes.list.invalidate();
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
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <FileText className="w-5 h-5 text-orange-400" /> Nuevo Presupuesto
          {leadName && <span className="text-white/40 text-sm font-normal ml-1">para {leadName}</span>}
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
            <Label className="text-white/60 text-xs">Asunto del presupuesto *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1"
            />
            <p className="text-white/30 text-xs mt-1">Generado automáticamente. Puedes editarlo.</p>
          </div>
          <div>
            <Label className="text-white/60 text-xs">Válido hasta</Label>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="bg-white/5 border-white/10 text-white mt-1"
            />
          </div>
          <div>
            <Label className="text-white/60 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
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
            <Label className="text-white/60 text-xs">
              Conceptos * <span className="text-white/30">(escribe o busca un producto)</span>
            </Label>
            <Button
              size="sm"
              variant="ghost"
              className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general_21" }])}
            >
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="text-xs text-white/30 grid grid-cols-12 gap-2 mb-1">
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
                        const fr = (p as any).fiscalRegime === "reav" ? "reav" : "general_21";
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity, fiscalRegime: fr };
                      }));
                    }}
                  />
                </div>
                <select
                  className="col-span-2 bg-white/5 border border-white/10 text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime ?? "general_21"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: e.target.value as "reav" | "general_21" } : it))}
                >
                  <option value="general_21" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input
                  className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center"
                  type="number"
                  min={1}
                  value={item.quantity}
                  onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                />
                <Input
                  className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right"
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
                  className="col-span-1 text-white/30 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Código promocional */}
        <div className="bg-white/5 rounded-xl p-3">
          <Label className="text-white/60 text-xs mb-1.5 block">Código de descuento (opcional)</Label>
          {promoData ? (
            <div className="flex items-center justify-between bg-green-900/30 border border-green-700/40 rounded-lg px-3 py-2">
              <span className="font-mono font-bold text-green-400 text-sm">{promoData.code} — -{promoData.discountPercent}%</span>
              <button onClick={() => { setPromoData(null); setPromoInput(""); }} className="text-white/40 hover:text-red-400 text-xs ml-2">× Quitar</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm font-mono uppercase"
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
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-white/60"><span>Subtotal rég. general</span><span>{generalSubtotalBuilder.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotalBuilder).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-white/60"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {promoDiscount > 0 && (
            <div className="flex justify-between text-sm text-green-400"><span>Descuento {promoData?.code}</span><span>-{promoDiscount.toFixed(2)} €</span></div>
          )}
          {generalSubtotalBuilder > 0 && (
            <div className="flex justify-between text-sm text-white/60"><span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span></div>
          )}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-2 mt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>

        <div>
          <Label className="text-white/60 text-xs">Notas para el cliente</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Información adicional visible para el cliente..."
            className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1 resize-none h-16 text-sm"
          />
        </div>
        <div>
          <Label className="text-white/60 text-xs">Condiciones</Label>
          <Textarea
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            className="bg-white/5 border-white/10 text-white mt-1 resize-none h-12 text-sm"
          />
        </div>
      </div>

      <DialogFooter className="gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => handleSubmit(false)}
          disabled={convertToQuote.isPending}
          className="bg-white/10 hover:bg-white/20 text-white border border-white/15"
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
  onSelect: (product: { title: string; unitPrice: number; fiscalRegime: "reav" | "general_21" }) => void;
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
        className="w-full bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm"
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
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/15 rounded-lg shadow-2xl overflow-hidden">
          {isFetching && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-white/40">
              <RefreshCw className="w-3 h-3 animate-spin" /> Buscando...
            </div>
          )}
          {!isFetching && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-white/30">Sin resultados para "{query}"</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-white/10 transition-colors text-left group"
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(r.title);
                onChange(r.title);
                onSelect({ title: r.title, unitPrice: r.unitPrice, fiscalRegime: r.fiscalRegime });
                setOpen(false);
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[10px] font-semibold shrink-0 ${TYPE_COLORS[r.type] ?? "text-white/40"}`}>
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
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]>([]);
  const [initialized, setInitialized] = useState(false);

  if (data && !initialized) {
    const q = data.quote;
    setTitle(q.title ?? "");
    setConditions(q.conditions ?? "");
    setNotes(q.notes ?? "");
    setTaxRate(q.tax ? parseFloat(String(q.tax)) : 21);
    setValidUntil(q.validUntil ? new Date(q.validUntil).toISOString().split("T")[0] : "");
    const rawItems = (q.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]) ?? [];
    setItems(rawItems.length > 0 ? rawItems : [{ description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general_21" }]);
    setInitialized(true);
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const generalSubtotalEdit = items.filter(i => i.fiscalRegime !== "reav").reduce((s, i) => s + i.total, 0);
  const taxAmount = parseFloat((generalSubtotalEdit * (taxRate / 100)).toFixed(2));
  const total = parseFloat((subtotal + taxAmount).toFixed(2));

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") updated.total = Number(updated.quantity) * Number(updated.unitPrice);
      return updated;
    }));
  };

  // Seleccionar producto del catálogo: rellena descripción, precio y régimen
  const selectCatalogProduct = (idx: number, product: { title: string; unitPrice: number; fiscalRegime: "reav" | "general_21" }) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const qty = item.quantity || 1;
      return {
        ...item,
        description: product.title,
        unitPrice: product.unitPrice,
        fiscalRegime: product.fiscalRegime,
        total: qty * product.unitPrice,
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
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Pencil className="w-4 h-4 text-orange-400" /> Editar Presupuesto
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Título *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Válido hasta</Label>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">IVA (%)</Label>
            <Select value={String(taxRate)} onValueChange={(v) => setTaxRate(Number(v))}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#0d1526] border-white/10">
                <SelectItem value="0" className="text-white">0% (exento)</SelectItem>
                <SelectItem value="10" className="text-white">10%</SelectItem>
                <SelectItem value="21" className="text-white">21%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-white/60 text-xs">Conceptos *</Label>
            <Button size="sm" variant="ghost" className="text-orange-400 hover:text-orange-300 text-xs h-6"
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0, fiscalRegime: "general_21" }])}>
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="text-xs text-white/30 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-4">Descripción</span>
            <span className="col-span-2 text-center">Régimen</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <ProductAutocompleteInput
                  value={item.description}
                  onChange={(v) => updateItem(idx, "description", v)}
                  onSelect={(product) => selectCatalogProduct(idx, product)}
                />
                <select
                  className="col-span-2 bg-white/5 border border-white/10 text-white text-xs rounded-md px-1 py-1.5 h-9"
                  value={item.fiscalRegime ?? "general_21"}
                  onChange={(e) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, fiscalRegime: e.target.value as "reav" | "general_21" } : it))}
                >
                  <option value="general_21" className="bg-[#0d1526]">IVA 21%</option>
                  <option value="reav" className="bg-[#0d1526]">REAV</option>
                </select>
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className={`col-span-1 text-right text-sm font-semibold ${item.fiscalRegime === "reav" ? "text-amber-400" : "text-orange-400"}`}>{item.total.toFixed(2)} €</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-white/30 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          {items.some(i => i.fiscalRegime === "reav") && items.some(i => i.fiscalRegime !== "reav") && (
            <>
              <div className="flex justify-between text-sm text-white/60"><span>Subtotal rég. general</span><span>{generalSubtotalEdit.toFixed(2)} €</span></div>
              <div className="flex justify-between text-sm text-amber-400/70"><span>Subtotal REAV (sin IVA)</span><span>{(subtotal - generalSubtotalEdit).toFixed(2)} €</span></div>
            </>
          )}
          {!items.some(i => i.fiscalRegime === "reav") && (
            <div className="flex justify-between text-sm text-white/60"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          )}
          {generalSubtotalEdit > 0 && (
            <div className="flex justify-between text-sm text-white/60"><span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span></div>
          )}
          {items.every(i => i.fiscalRegime === "reav") && (
            <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
          )}
          <div className="flex justify-between text-base font-bold text-white border-t border-white/10 pt-2">
            <span>TOTAL</span><span className="text-orange-400 text-xl">{total.toFixed(2)} €</span>
          </div>
        </div>
        <div>
          <Label className="text-white/60 text-xs">Notas para el cliente</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1 resize-none h-16 text-sm" />
        </div>
        <div>
          <Label className="text-white/60 text-xs">Condiciones</Label>
          <Textarea value={conditions} onChange={(e) => setConditions(e.target.value)} className="bg-white/5 border-white/10 text-white mt-1 resize-none h-12 text-sm" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
        <Button
          size="sm"
          onClick={() => updateQuote.mutate({ id: quoteId, title, conditions, notes, items, subtotal, taxRate, total, validUntil })}
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
  created:  { icon: <FileText className="w-3.5 h-3.5" />, color: "text-white/60", bg: "bg-white/10" },
  sent:     { icon: <Send className="w-3.5 h-3.5" />, color: "text-blue-400", bg: "bg-blue-500/20" },
  viewed:   { icon: <Eye className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  reminder: { icon: <RefreshCw className="w-3.5 h-3.5" />, color: "text-amber-400", bg: "bg-amber-500/20" },
  accepted: { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-emerald-400", bg: "bg-emerald-500/20" },
  rejected: { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-red-400", bg: "bg-red-500/20" },
  paid:     { icon: <CheckCircle className="w-3.5 h-3.5" />, color: "text-orange-400", bg: "bg-orange-500/20" },
  lost:     { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-red-400", bg: "bg-red-500/20" },
  expired:  { icon: <XCircle className="w-3.5 h-3.5" />, color: "text-white/40", bg: "bg-white/10" },
  activity: { icon: <ArrowUpRight className="w-3.5 h-3.5" />, color: "text-purple-400", bg: "bg-purple-500/20" },
};

function QuoteTimeline({ quoteId }: { quoteId: number }) {
  const { data, isLoading } = trpc.crm.timeline.get.useQuery({ quoteId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <RefreshCw className="w-4 h-4 animate-spin text-white/30" />
      </div>
    );
  }

  if (!data || data.events.length === 0) {
    return <p className="text-xs text-white/30 text-center py-4">Sin actividad registrada</p>;
  }

  return (
    <div className="relative">
      {/* Línea vertical */}
      <div className="absolute left-[15px] top-0 bottom-0 w-px bg-white/10" />
      <div className="space-y-3">
        {data.events.map((event, idx) => {
          const cfg = TIMELINE_CONFIG[event.type as TimelineEventType] ?? TIMELINE_CONFIG.activity;
          const isLast = idx === data.events.length - 1;
          return (
            <div key={event.id} className="flex gap-3 relative">
              {/* Icono */}
              <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg} ${cfg.color} border border-white/10`}>
                {cfg.icon}
              </div>
              {/* Contenido */}
              <div className={`flex-1 pb-3 ${isLast ? "" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-sm font-medium ${cfg.color}`}>{event.label}</span>
                  <span className="text-xs text-white/30 whitespace-nowrap flex-shrink-0">
                    {new Date(event.timestamp).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {event.detail && (
                  <p className="text-xs text-white/40 mt-0.5">{event.detail}</p>
                )}
                {event.actor && (
                  <p className="text-xs text-white/30 mt-0.5">Por: {event.actor}</p>
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
  // Transfer proof modal state
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferFile, setTransferFile] = useState<File | null>(null);
  const [transferProofUrl, setTransferProofUrl] = useState<string | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState(false);
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
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
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

  const confirmPaymentWithMethod = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: (data) => {
      const label = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "tarjeta";
      toast.success(`Pago confirmado (${label}) · Factura ${(data as { invoiceNumber?: string })?.invoiceNumber ?? ""} generada`);
      utils.crm.quotes.get.invalidate({ id: quoteId });
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.counters.invalidate();
      setShowConfirmPaymentModal(false);
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
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  if (!data) return null;
  const { quote, lead, invoices: relatedInvoices } = data;
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number; fiscalRegime?: "reav" | "general_21" }[]) ?? [];
  const reavItems = items.filter(i => i.fiscalRegime === "reav");
  const generalItems = items.filter(i => i.fiscalRegime !== "reav");
  const hasReav = reavItems.length > 0;
  const hasGeneral = generalItems.length > 0;

  return (
    <>
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
      <div className="overflow-y-auto flex-1 px-6 pt-6 pb-2">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-700/20 border border-orange-500/30 flex items-center justify-center">
            <FileText className="w-4 h-4 text-orange-400" />
          </div>
          <div>
            <div className="font-bold">{quote.quoteNumber}</div>
            <div className="text-sm text-white/50 font-normal">{lead?.name ?? "Cliente"}</div>
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
          {quote.sentAt && <span className="text-xs text-white/40">Enviado {new Date(quote.sentAt).toLocaleDateString("es-ES")}</span>}
          {quote.viewedAt && <span className="text-xs text-emerald-400">Visto ✓</span>}
        </div>

        <div className="bg-white/5 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10">
            <h3 className="font-semibold text-white text-sm">{quote.title}</h3>
            {quote.description && <p className="text-xs text-white/50 mt-0.5">{quote.description}</p>}
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-white/5">
                <th className="text-left px-4 py-2 text-xs text-white/40 font-medium">Concepto</th>
                <th className="text-center px-4 py-2 text-xs text-white/40 font-medium">Cant.</th>
                <th className="text-right px-4 py-2 text-xs text-white/40 font-medium">P.Unit.</th>
                <th className="text-right px-4 py-2 text-xs text-white/40 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {hasGeneral && hasReav && (
                <tr className="border-t border-white/5 bg-blue-500/5">
                  <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-blue-300 uppercase tracking-wider">Régimen General (IVA 21%)</td>
                </tr>
              )}
              {(hasGeneral && hasReav ? generalItems : items).map((item, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-sm text-white/80">{item.description}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-orange-400 text-right">{Number(item.total).toFixed(2)} €</td>
                </tr>
              ))}
              {hasReav && (
                <>
                  <tr className="border-t border-white/5 bg-amber-500/5">
                    <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold text-amber-300 uppercase tracking-wider">REAV — Sin IVA (Régimen Especial Agencias de Viaje)</td>
                  </tr>
                  {reavItems.map((item, i) => (
                    <tr key={`reav-${i}`} className="border-t border-white/5">
                      <td className="px-4 py-2.5 text-sm text-white/80">
                        {item.description}
                        <span className="ml-1.5 text-xs bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">REAV</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-white/60 text-center">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-sm text-white/60 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-amber-400 text-right">{Number(item.total).toFixed(2)} €</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-white/10 space-y-1">
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>Descuento</span><span>-{Number(quote.discount).toFixed(2)} €</span>
              </div>
            )}
            {hasGeneral && hasReav && (
              <>
                <div className="flex justify-between text-sm text-white/50">
                  <span>Subtotal rég. general</span><span>{generalItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</span>
                </div>
                <div className="flex justify-between text-sm text-amber-400/70">
                  <span>Subtotal REAV (sin IVA)</span><span>{reavItems.reduce((s,i) => s+i.total,0).toFixed(2)} €</span>
                </div>
              </>
            )}
            {Number(quote.tax) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>IVA (21%)</span><span>{Number(quote.tax).toFixed(2)} €</span>
              </div>
            )}
            {hasReav && !hasGeneral && (
              <div className="text-xs text-amber-300/70 italic">Operación REAV — No procede IVA al cliente</div>
            )}
            <div className="flex justify-between items-center pt-1">
              <span className="font-bold text-white">TOTAL</span>
              <span className="text-xl font-bold text-orange-400">{Number(quote.total).toFixed(2)} €</span>
            </div>
          </div>
        </div>

        {/* Invoices */}
        {relatedInvoices.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Facturas generadas</h4>
            {relatedInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <div>
                  <span className="text-sm font-medium text-emerald-400">{inv.invoiceNumber}</span>
                  <span className="text-xs text-white/40 ml-2">{new Date(inv.issuedAt).toLocaleDateString("es-ES")}</span>
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
            className="flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors w-full py-1"
          >
            <div className="flex-1 h-px bg-white/10" />
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
              <Eye className="w-3 h-3" />
              {showTimeline ? "Ocultar historial" : "Ver historial de actividad"}
            </span>
            <div className="flex-1 h-px bg-white/10" />
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
            <Label className="text-white/60 text-xs">Link de pago (opcional)</Label>
            <Input
              value={paymentLink}
              onChange={(e) => setPaymentLink(e.target.value)}
              placeholder="https://..."
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 mt-1 text-sm"
            />
          </div>
        )}
      </div>

      </div>
      <DialogFooter className="flex gap-2 flex-wrap pt-3 pb-4 px-6 border-t border-white/10 shrink-0">
        {/* Confirmar Pago — botón unificado */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito") && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            onClick={() => setShowConfirmPaymentModal(true)}
          >
            <CheckCircle className="w-3.5 h-3.5 mr-1" />
            Confirmar Pago
          </Button>
        )}
        {/* Enviar / Reenviar */}
        {quote.status === "borrador" && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="border-white/15 text-white/60 text-xs"
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
        {quote.status === "enviado" && (
          <Button size="sm" variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-xs" onClick={() => resendQuote.mutate({ id: quoteId, origin: window.location.origin })} disabled={resendQuote.isPending}>
            {resendQuote.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
            Reenviar
          </Button>
        )}
        {/* Pago Pendiente */}
        {(quote.status === "enviado" || quote.status === "borrador" || quote.status === "convertido_carrito") && (
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
        {/* Descargar PDF */}
        <Button size="sm" variant="outline" className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs" onClick={downloadPdf} disabled={generatePdf.isPending}>
          {generatePdf.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileDown className="w-3.5 h-3.5 mr-1" />}
          Descargar PDF
        </Button>
        {/* Duplicar */}
        <Button size="sm" variant="ghost" className="text-white/40 hover:text-white text-xs" onClick={() => duplicate.mutate({ id: quoteId })} disabled={duplicate.isPending}>
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
      <Dialog open={showTransferModal} onOpenChange={setShowTransferModal}>
        <DialogContent className="max-w-md bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Banknote className="w-5 h-5 text-blue-400" />
              Confirmar pago por transferencia
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-white/60">
              Para validar el pago por transferencia bancaria debes adjuntar obligatoriamente el justificante (JPG, PNG o PDF).
              Solo cuando esté adjunto podrás confirmar el pago, generar la reserva y la factura.
            </p>
            <div className="border-2 border-dashed border-white/20 rounded-lg p-4 text-center hover:border-blue-500/50 transition-colors">
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf"
                onChange={handleTransferFileChange}
                className="hidden"
                id="transfer-proof-input"
              />
              <label htmlFor="transfer-proof-input" className="cursor-pointer">
                {isUploadingProof ? (
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
                    <span className="text-sm text-white/60">Subiendo justificante...</span>
                  </div>
                ) : transferProofUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-emerald-400" />
                    <span className="text-sm text-emerald-400 font-medium">Justificante adjuntado</span>
                    <span className="text-xs text-white/40">{transferFile?.name}</span>
                    <span className="text-xs text-blue-400 underline">Cambiar archivo</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-white/40" />
                    <span className="text-sm text-white/60">Haz clic para adjuntar el justificante</span>
                    <span className="text-xs text-white/30">JPG, PNG o PDF · Máx. 10 MB</span>
                  </div>
                )}
              </label>
            </div>
            {transferProofUrl && (
              <a
                href={transferProofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 underline"
              >
                <Eye className="w-3.5 h-3.5" /> Ver justificante adjuntado
              </a>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              className="text-white/60 hover:text-white"
              onClick={() => { setShowTransferModal(false); setTransferFile(null); setTransferProofUrl(null); }}
            >
              Cancelar
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!transferProofUrl || confirmTransfer.isPending}
              onClick={() => confirmTransfer.mutate({ quoteId })}
            >
              {confirmTransfer.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Confirmando...</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" /> Validar pago y generar factura</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Confirmar Pago (método unificado con campos específicos) ─── */}
      <Dialog open={showConfirmPaymentModal} onOpenChange={(o) => {
        if (!o) { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); }
      }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" />
              Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-white/60 text-sm">Selecciona el método de pago y completa los datos antes de confirmar.</p>
            {/* Selector de método */}
            <div className="grid grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button key={m}
                  onClick={() => { setPaymentMethodSelected(m); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    paymentMethodSelected === m ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-white/50 hover:border-white/25 hover:text-white/80"
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
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">Nº operación TPV *</Label>
                <Input value={viewTpvOp} onChange={(e) => setViewTpvOp(e.target.value)} placeholder="Ej: 000123456789" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm" />
              </div>
            )}
            {paymentMethodSelected === "transferencia" && (
              <div className="space-y-2">
                <Label className="text-white/70 text-xs">Justificante de transferencia *</Label>
                {!viewProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingViewProof ? "border-white/20 bg-white/5" : "border-white/20 bg-white/5 hover:border-emerald-500/50 hover:bg-emerald-500/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleViewProofFileChange} disabled={isUploadingViewProof} />
                    {isUploadingViewProof ? (
                      <><RefreshCw className="w-5 h-5 text-white/40 animate-spin" /><span className="text-xs text-white/40">Subiendo...</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-white/40" /><span className="text-xs text-white/50">Haz clic o arrastra el justificante (PDF, JPG, PNG)</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">Justificante subido correctamente</span>
                    <a href={viewProofUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Ver</a>
                    <button onClick={() => { setViewProofUrl(null); setViewProofKey(null); }} className="text-white/30 hover:text-white/60 ml-1">×</button>
                  </div>
                )}
              </div>
            )}
            {paymentMethodSelected === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">Justificación *</Label>
                <Textarea value={viewPayNote} onChange={(e) => setViewPayNote(e.target.value)} placeholder="Ej: Cobrado en recepción el 31/03/2026" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-white/60 hover:text-white" onClick={() => { setShowConfirmPaymentModal(false); setPaymentMethodSelected("tarjeta"); setViewTpvOp(""); setViewPayNote(""); setViewProofUrl(null); setViewProofKey(null); }}>Cancelar</Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={
                confirmPaymentWithMethod.isPending ||
                (paymentMethodSelected === "tarjeta" && !viewTpvOp.trim()) ||
                (paymentMethodSelected === "transferencia" && !viewProofUrl) ||
                (paymentMethodSelected === "efectivo" && !viewPayNote.trim())
              }
              onClick={() => {
                const payMethod = paymentMethodSelected === "transferencia" ? "transferencia" : paymentMethodSelected === "efectivo" ? "efectivo" : "redsys";
                confirmPaymentWithMethod.mutate({
                  quoteId,
                  paymentMethod: payMethod,
                  tpvOperationNumber: paymentMethodSelected === "tarjeta" ? viewTpvOp : undefined,
                  paymentNote: paymentMethodSelected === "efectivo" ? viewPayNote : undefined,
                  transferProofUrl: paymentMethodSelected === "transferencia" ? viewProofUrl ?? undefined : undefined,
                  transferProofKey: paymentMethodSelected === "transferencia" ? viewProofKey ?? undefined : undefined,
                });
              }}
            >
              {confirmPaymentWithMethod.isPending ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Procesando...</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" /> Confirmar y generar factura</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: Pago Pendiente ─── */}
      <Dialog open={showPendingPaymentModal} onOpenChange={setShowPendingPaymentModal}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" />
              Registrar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-white/60 text-sm">Se creará un registro de pago pendiente y se enviará un email de recordatorio al cliente con la fecha límite.</p>
            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Fecha límite de pago *</Label>
              <Input
                type="date"
                value={pendingDueDate}
                onChange={(e) => setPendingDueDate(e.target.value)}
                className="bg-white/5 border-white/10 text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Motivo / nota interna (opcional)</Label>
              <Textarea
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                placeholder="Ej: Cliente confirma pago por transferencia la próxima semana..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="text-white/60 hover:text-white" onClick={() => setShowPendingPaymentModal(false)}>Cancelar</Button>
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
}: {
  reservationId: number;
  onClose: () => void;
  onEdit: (id: number, status: string) => void;
}) {
  const { data, isLoading } = trpc.crm.reservations.get.useQuery({ id: reservationId });

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
    if (!method) return <span className="text-white/20 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      redsys:        { label: "Tarjeta (Redsys)",  cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      transferencia: { label: "Transferencia",      cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",         icon: "🏦" },
      efectivo:      { label: "Efectivo",           cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: "💵" },
      otro:          { label: "Otro",               cls: "bg-white/10 text-white/50 border-white/15",             icon: "❓" },
    };
    const s = map[method] ?? { label: method, cls: "bg-white/10 text-white/50 border-white/15", icon: "" };
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
        <span>{s.icon}</span>{s.label}
      </span>
    );
  };

  if (isLoading) {
    return (
      <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white">
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
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] flex flex-col overflow-hidden p-0">
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
                <span className="text-xs text-white/30 font-normal font-mono">{res.merchantOrder}</span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          {/* Estado, método de pago y canal */}
          <div className="flex items-center gap-3 flex-wrap">
            {getStatusBadge(res.status)}
            {getPaymentBadge(res.paymentMethod)}
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
          <div className="bg-white/[0.04] border border-white/8 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Datos del cliente</h4>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-white/40 mb-0.5">Nombre</div>
                <div className="text-sm text-white font-medium">{res.customerName}</div>
              </div>
              <div>
                <div className="text-xs text-white/40 mb-0.5">Email</div>
                <a href={`mailto:${res.customerEmail}`} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
                  {res.customerEmail}
                </a>
              </div>
              {res.customerPhone && (
                <div>
                  <div className="text-xs text-white/40 mb-0.5">Teléfono</div>
                  <a href={`tel:${res.customerPhone}`} className="text-sm text-sky-400 hover:text-sky-300 transition-colors">
                    {res.customerPhone}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Detalles de la reserva */}
          <div className="bg-white/[0.04] border border-white/8 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Detalles de la reserva</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Producto</span>
                <span className="text-white font-medium text-right max-w-[60%]">{res.productName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Fecha de actividad</span>
                <span className="text-white font-medium">{res.bookingDate || "—"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Personas</span>
                <span className="text-white font-medium">{res.people} pax</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Importe total</span>
                <span className="text-orange-400 font-bold">{totalEur} €</span>
              </div>
              {res.amountPaid !== res.amountTotal && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Importe cobrado</span>
                  <span className="text-emerald-400 font-bold">{amountEur} €</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Referencia</span>
                <span className="font-mono text-white/60 text-xs">{res.merchantOrder}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/50">Creada el</span>
                <span className="text-white/60">{new Date(res.createdAt).toLocaleString("es-ES")}</span>
              </div>
              {res.paidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Pagada el</span>
                  <span className="text-emerald-400">{new Date(res.paidAt).toLocaleString("es-ES")}</span>
                </div>
              )}
            </div>
          </div>

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
              <p className="text-sm text-white/70">{res.notes}</p>
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
            const generalItems = allItems.filter(i => !i.fiscalRegime || i.fiscalRegime === "general_21");
            const reavItems = allItems.filter(i => i.fiscalRegime === "reav");
            return (
              <div className="bg-white/[0.04] border border-white/8 rounded-xl p-4">
                <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Líneas del pedido</h4>
                <div className="space-y-1">
                  {/* Header */}
                  <div className="grid grid-cols-12 gap-2 text-xs text-white/30 font-medium pb-1 border-b border-white/8">
                    <div className="col-span-6">Concepto</div>
                    <div className="col-span-2 text-center">Cant.</div>
                    <div className="col-span-2 text-right">P.Unit.</div>
                    <div className="col-span-2 text-right">Total</div>
                  </div>
                  {/* General items */}
                  {generalItems.length > 0 && (
                    <>
                      <div className="text-xs font-semibold text-white/50 pt-1 pb-0.5">Régimen General (IVA 21%)</div>
                      {generalItems.map((item, i) => (
                        <div key={`g-${i}`} className="grid grid-cols-12 gap-2 text-sm py-1">
                          <div className="col-span-6 text-white/80">{item.description}</div>
                          <div className="col-span-2 text-center text-white/60">{item.quantity}</div>
                          <div className="col-span-2 text-right text-white/60">{Number(item.unitPrice).toFixed(2)} €</div>
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
                          <div className="col-span-6 text-white/80 flex items-center gap-1.5">
                            {item.description}
                            <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1 py-0.5 rounded">REAV</span>
                          </div>
                          <div className="col-span-2 text-center text-white/60">{item.quantity}</div>
                          <div className="col-span-2 text-right text-white/60">{Number(item.unitPrice).toFixed(2)} €</div>
                          <div className="col-span-2 text-right text-orange-400 font-medium">{Number(item.total).toFixed(2)} €</div>
                        </div>
                      ))}
                    </>
                  )}
                  {/* Totals */}
                  <div className="border-t border-white/8 pt-2 mt-1 space-y-1">
                    {generalItems.length > 0 && reavItems.length > 0 && (
                      <div className="flex justify-between text-xs text-white/40">
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
                    <div className="flex justify-between text-sm font-bold text-white">
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
              <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Facturas asociadas</h4>
              <div className="space-y-2">
                {relatedInvoices.map((inv: any) => (
                  <div key={inv.id} className="flex items-center justify-between bg-white/5 border border-white/8 rounded-xl px-4 py-3">
                    <div>
                      <div className="text-sm font-mono font-bold text-white">{inv.invoiceNumber}</div>
                      <div className="text-xs text-white/40 mt-0.5">
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
              <h4 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Historial de actividad</h4>
              <div className="space-y-1.5">
                {activity.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 mt-2 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white/70">{translateAction(log.action)}</div>
                      {log.actorName && (
                        <div className="text-xs text-white/30">{log.actorName}</div>
                      )}
                    </div>
                    <div className="text-xs text-white/30 shrink-0">
                      {new Date(log.createdAt).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <DialogFooter className="px-6 py-4 border-t border-white/8 flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">
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
        {relatedInvoices[0]?.pdfUrl && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => window.open(relatedInvoices[0].pdfUrl ?? undefined, "_blank")}
          >
            <FileDown className="w-4 h-4 mr-1" /> Descargar factura PDF
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ─── MAIN CRM DASHBOARD ───────────────────────────────────────────────────────

export default function CRMDashboard() {
  // Leer el tab inicial desde la URL (?tab=leads|quotes|reservations|invoices)
  const initialTab = (): Tab => {
    try {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab");
      if (t === "leads" || t === "quotes" || t === "reservations" || t === "invoices" || t === "anulaciones" || t === "pagos_pendientes") return t;
    } catch { /* ignore */ }
    return "leads";
  };
  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
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

  const leadsFilter = useMemo(() => ({
    opportunityStatus: filterStatus !== "all" && tab === "leads" ? (filterStatus as OpportunityStatus) : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

  const quotesFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "quotes" ? (filterStatus as QuoteStatus) : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

  const resFilter = useMemo(() => ({
    status: filterStatus !== "all" && tab === "reservations" ? filterStatus : undefined,
    channel: resChannelFilter !== "all" ? resChannelFilter : undefined,
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, resChannelFilter, search, tab]);

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
  // ─── Anulaciones state ───────────────────────────────────────────────────────
  const [anulSearch, setAnulSearch] = useState("");
  const [anulOpFilter, setAnulOpFilter] = useState("all");
  const [anulResFilter, setAnulResFilter] = useState("all");
  const [anulFinFilter, setAnulFinFilter] = useState("all");
  const [anulReasonFilter, setAnulReasonFilter] = useState("all");
  const [selectedAnulId, setSelectedAnulId] = useState<number | null>(null);
  const [deleteAnulId, setDeleteAnulId] = useState<number | null>(null);
  const { data: anulData, isLoading: anulLoading, refetch: refetchAnul } = trpc.cancellations.listRequests.useQuery({
    search: anulSearch || undefined,
    operationalStatus: anulOpFilter !== "all" ? anulOpFilter : undefined,
    resolutionStatus: anulResFilter !== "all" ? anulResFilter : undefined,
    financialStatus: anulFinFilter !== "all" ? anulFinFilter : undefined,
    reason: anulReasonFilter !== "all" ? anulReasonFilter : undefined,
    limit: 100,
    offset: 0,
  }, { enabled: tab === "anulaciones" });
  const { data: anulCounters } = trpc.cancellations.getCounters.useQuery(undefined, {
    refetchInterval: 60000,
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

  const confirmPaymentMutation = trpc.crm.quotes.confirmPayment.useMutation({
    onSuccess: () => {
      toast.success("Pago confirmado — reserva y factura generadas");
      setConfirmPaymentId(null);
      utils.crm.quotes.list.invalidate();
      utils.crm.quotes.counters.invalidate();
      utils.crm.leads.counters.invalidate();
      utils.crm.reservations.list.invalidate();
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

  const downloadInvoicePdf = (invoice: any) => {
    if (invoice.pdfUrl) {
      window.open(invoice.pdfUrl, "_blank");
    } else {
      toast.error("No hay PDF disponible para esta factura");
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
    const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50 border-white/10" };
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>{s.label}</span>;
  };

  const getPaymentMethodLabel = (method: string | null) => {
    if (!method) return null;
    const map: Record<string, string> = {
      redsys: "💳 Tarjeta (Redsys)",
      transferencia: "🏦 Transferencia",
      efectivo: "💵 Efectivo",
      otro: "❓ Otro",
    };
    return map[method] ?? method;
  };

  const getPaymentMethodBadge = (method: string | null) => {
    if (!method) return <span className="text-white/20 text-xs">—</span>;
    const map: Record<string, { label: string; cls: string; icon: string }> = {
      redsys:        { label: "Tarjeta",       cls: "bg-violet-500/15 text-violet-300 border-violet-500/30", icon: "💳" },
      transferencia: { label: "Transferencia", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30",         icon: "🏦" },
      efectivo:      { label: "Efectivo",      cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: "💵" },
      otro:          { label: "Otro",          cls: "bg-white/10 text-white/50 border-white/15",             icon: "❓" },
    };
    const s = map[method] ?? { label: method, cls: "bg-white/10 text-white/50 border-white/15", icon: "" };
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
      <div className="min-h-screen bg-[#080e1c] text-white">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold text-white">CRM Comercial</h1>
              <p className="text-sm text-white/40 mt-0.5">Pipeline completo Lead → Presupuesto → Reserva → Factura</p>
            </div>
          </div>
        </div>

        {/* Top KPI strip — dos grupos diferenciados */}
        <div className="px-6 py-5 space-y-4">

          {/* Grupo 1: Pipeline de Oportunidades */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-blue-400 to-blue-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">Pipeline de Oportunidades</span>
              <div className="flex-1 h-px bg-white/5" />
              {(leadCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-white/30">{leadCounters?.total ?? 0} leads totales</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="Nueva Oportunidad"
                value={leadCounters?.nueva ?? 0}
                icon={Users}
                color="blue"
                subtitle="Leads sin gestionar"
                active={tab === "leads" && filterStatus === "nueva"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("nueva"); }}
              />
              <CounterCard
                label="Oportunidad Enviada"
                value={leadCounters?.enviada ?? 0}
                icon={Send}
                color="amber"
                subtitle="Presupuesto en cliente"
                active={tab === "leads" && filterStatus === "enviada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("enviada"); }}
              />
              <CounterCard
                label="Oportunidad Ganada"
                value={leadCounters?.ganada ?? 0}
                icon={Star}
                color="green"
                subtitle="Reservas confirmadas"
                active={tab === "leads" && filterStatus === "ganada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("ganada"); }}
              />
              <CounterCard
                label="Oportunidad Perdida"
                value={leadCounters?.perdida ?? 0}
                icon={XCircle}
                color="red"
                subtitle="Descartadas manualmente"
                active={tab === "leads" && filterStatus === "perdida"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("perdida"); }}
              />
            </div>
          </div>

          {/* Grupo 2: Presupuestos & Ingresos */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-orange-400 to-orange-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">Presupuestos &amp; Ingresos</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label="En Borrador"
                value={quoteCounters?.borrador ?? 0}
                icon={FileText}
                color="slate"
                subtitle="Pendientes de enviar"
                active={tab === "quotes" && filterStatus === "borrador"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("borrador"); }}
              />
              <CounterCard
                label="Enviados al Cliente"
                value={quoteCounters?.enviado ?? 0}
                icon={Clock}
                color="amber"
                subtitle="Esperando respuesta"
                active={tab === "quotes" && filterStatus === "enviado"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("enviado"); }}
              />
              <CounterCard
                label="Reservas Hoy"
                value={resCounters?.hoy ?? 0}
                icon={CalendarCheck}
                color="green"
                subtitle="Confirmadas hoy"
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
          {/* Grupo 3: Anulaciones */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-red-400 to-red-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">Anulaciones</span>
              <div className="flex-1 h-px bg-white/5" />
              {(anulCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-white/30">{anulCounters?.total ?? 0} totales</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <CounterCard
                label="Pendientes"
                value={anulCounters?.pending ?? 0}
                icon={AlertTriangle}
                color="red"
                subtitle="Sin resolver"
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label="Incidencias"
                value={anulCounters?.incidencias ?? 0}
                icon={AlertCircle}
                color="red"
                subtitle="Requieren atención"
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label="Total"
                value={anulCounters?.total ?? 0}
                icon={Archive}
                color="slate"
                subtitle="Todas las solicitudes"
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
            </div>
          </div>
        </div>

        {/* Barra de ratio de conversión */}
        {(leadCounters?.total ?? 0) > 0 && (
          <div className="px-6 pb-4">
            <div className="bg-white/3 border border-white/8 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-white/40">Ratio de Conversión</span>
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
                <div className="flex items-center gap-4 text-xs text-white/40">
                  <span className="text-emerald-400 font-bold text-sm">
                    {leadCounters?.total ? Math.round(((leadCounters.ganada ?? 0) / leadCounters.total) * 100) : 0}%
                  </span>
                  <span>{leadCounters?.ganada ?? 0} ganadas de {leadCounters?.total ?? 0} leads</span>
                </div>
              </div>
              {/* Barra segmentada */}
              <div className="relative h-3 bg-white/5 rounded-full overflow-hidden">
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
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  Ganadas ({leadCounters?.ganada ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  Enviadas ({leadCounters?.enviada ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500/40" />
                  Nuevas ({leadCounters?.nueva ?? 0})
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/40">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
                  Perdidas ({leadCounters?.perdida ?? 0})
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="px-6">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
            {([
              { key: "leads", label: "Leads", icon: Users, count: leadCounters?.total },
              { key: "quotes", label: "Presupuestos", icon: FileText, count: quoteCounters?.enviado },
              { key: "reservations", label: "Reservas", icon: CalendarCheck, count: resCounters?.confirmadas },
              { key: "invoices", label: "Facturas", icon: Receipt, count: undefined },
              { key: "anulaciones", label: "Anulaciones", icon: AlertTriangle, count: anulCounters?.pending },
              { key: "pagos_pendientes", label: "Pagos Pendientes", icon: Clock, count: undefined },
            ] as const).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${tab === key ? "bg-orange-600 text-white shadow-lg shadow-orange-900/30" : "text-white/50 hover:text-white hover:bg-white/5"}`}
              >
                <Icon className="w-4 h-4" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === key ? "bg-white/20 text-white" : "bg-white/10 text-white/60"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Search & filter */}
        {tab !== "anulaciones" && (
        <div className="px-6 py-4 flex gap-3 items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Buscar ${tab === "leads" ? "leads" : tab === "quotes" ? "presupuestos" : tab === "reservations" ? "reservas" : "facturas"}...`}
              className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
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
              <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white text-xs h-9">
                <SelectValue placeholder="Canal" />
              </SelectTrigger>
              <SelectContent className="bg-[#0d1520] border-white/10">
                <SelectItem value="all" className="text-white/70 text-xs">📊 Todos los canales</SelectItem>
                <SelectItem value="tpv" className="text-violet-300 text-xs">🖥️ TPV Presencial</SelectItem>
                <SelectItem value="web" className="text-sky-300 text-xs">🌐 Online</SelectItem>
                <SelectItem value="crm" className="text-purple-300 text-xs">💼 CRM Delegado</SelectItem>
                <SelectItem value="telefono" className="text-amber-300 text-xs">📞 Teléfono</SelectItem>
                <SelectItem value="coupon" className="text-orange-300 text-xs">🎫 Plataformas (Cupón)</SelectItem>
                <SelectItem value="otro" className="text-white/50 text-xs">❓ Otro</SelectItem>
              </SelectContent>
            </Select>
          )}
          {/* Botones de creación manual — visibles según el tab activo */}
          {tab === "leads" && (
            <Button
              size="sm"
              onClick={() => setShowNewLeadModal(true)}
              className="bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo Lead
            </Button>
          )}
          {tab === "reservations" && (
            <Button
              size="sm"
              onClick={() => setShowNewReservationModal(true)}
              className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nueva Reserva
            </Button>
          )}
          {tab === "quotes" && (
            <Button
              size="sm"
              onClick={() => setShowDirectQuoteModal(true)}
              className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> Nuevo Presupuesto
            </Button>
          )}
        </div>
        )}

        {/* Table */}
        <div className="px-6 pb-8">
          {tab === "leads" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">Fecha actividad</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Recibido</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsLoading ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !leadsData?.length ? (
                    <tr><td colSpan={6} className="text-center py-12 text-white/30 text-sm">No hay leads {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : leadsData.map((lead: any) => (
                    <tr key={lead.id} className={`border-t border-white/5 hover:bg-white/3 transition-colors ${!lead.seenAt ? "bg-blue-950/20" : ""}`}>
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
                              <span className="text-sm font-medium text-white">{lead.name}</span>
                              {!lead.seenAt && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Nuevo</span>}
                            </div>
                            <div className="text-xs text-white/40">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            {(lead.activitiesJson as any[]).slice(0, 2).map((act: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <span className="text-sm text-white/80">{act.experienceTitle}</span>
                                <span className="text-xs text-orange-400 font-semibold">{act.participants}p</span>
                              </div>
                            ))}
                            {(lead.activitiesJson as any[]).length > 2 && (
                              <span className="text-xs text-white/30">+{(lead.activitiesJson as any[]).length - 2} más</span>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-white/60">{lead.selectedProduct || lead.selectedCategory || "—"}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-sm text-white/50">{lead.preferredDate ? new Date(lead.preferredDate).toLocaleDateString("es-ES") : "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <OpportunityBadge status={lead.opportunityStatus as OpportunityStatus} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">{new Date(lead.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-white/50 hover:text-white h-7 px-2 text-xs"
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
          )}

          {tab === "quotes" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Referencia</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Título</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Total</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Fecha</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {quotesLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !quotesData?.length ? (
                    <tr><td colSpan={7} className="text-center py-12 text-white/30 text-sm">No hay presupuestos {filterStatus !== "all" ? `con estado "${filterStatus}"` : ""}</td></tr>
                  ) : quotesData.map((quote: any) => (
                    <tr key={quote.id} className="border-t border-white/5 hover:bg-white/3 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="text-sm font-mono font-medium text-orange-400">{quote.quoteNumber}</div>
                        <div className="text-[10px] text-white/30 mt-0.5">{new Date(quote.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white/90">{(quote as typeof quote & { clientName?: string }).clientName ?? "—"}</div>
                        <div className="text-[10px] text-white/40 truncate max-w-[140px]">{(quote as typeof quote & { clientEmail?: string }).clientEmail ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/70 truncate max-w-[180px]">{quote.title}</div>
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
                          {quote.sentAt && !quote.viewedAt && !quote.paidAt && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-white/30 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-full">
                              <Eye className="w-2.5 h-2.5" />
                              No visto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-white">{Number(quote.total).toFixed(2)} €</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">
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
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-white h-7 w-7 p-0" onClick={() => setSelectedQuoteId(quote.id)} title="Ver detalle">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-blue-300 h-7 w-7 p-0" onClick={() => setEditQuoteId(quote.id)} title="Editar">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {/* Enviar al cliente (solo borrador) */}
                          {(quote.status === "borrador") && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-orange-300 h-7 w-7 p-0" onClick={() => setSendQuoteId(quote.id)} title="Enviar al cliente">
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Reenviar (si ya fue enviado) */}
                          {quote.status === "enviado" && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-blue-300 h-7 w-7 p-0"
                              onClick={() => sendQuoteMutation.mutate({ id: quote.id, origin: window.location.origin })} title="Reenviar al cliente">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Confirmar pago (enviado o aceptado sin pago) */}
                          {(quote.status === "enviado" || (quote.status === "aceptado" && !quote.paidAt)) && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-emerald-300 h-7 w-7 p-0" onClick={() => setConfirmPaymentId(quote.id)} title="Confirmar pago recibido">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Convertir a reserva pendiente de cobro (icono 5 — usa flujo Pago Pendiente) */}
                          {quote.status === "enviado" && (
                            <Button
                              size="sm" variant="ghost"
                              className="text-white/40 hover:text-amber-300 h-7 w-7 p-0"
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
                          {(quote.status === "borrador" || quote.status === "enviado") && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-red-300 h-7 w-7 p-0" onClick={() => setMarkLostQuoteId(quote.id)} title="Marcar como perdido">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Descargar PDF */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-amber-300 h-7 w-7 p-0"
                            onClick={() => downloadQuotePdf(quote.id, quote.quoteNumber)} title="Descargar presupuesto en PDF"
                            disabled={generatePdfMutation.isPending}>
                            <FileDown className="w-3.5 h-3.5" />
                          </Button>
                          {/* Duplicar */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-white/70 h-7 w-7 p-0"
                            onClick={() => duplicateQuoteMutation.mutate({ id: quote.id })} title="Duplicar presupuesto">
                            <Copy className="w-3.5 h-3.5" />
                          </Button>
                          {/* Eliminar */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-red-400 h-7 w-7 p-0" onClick={() => setDeleteQuoteId(quote.id)} title="Eliminar">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "reservations" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Nº Reserva</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Est. Reserva</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Est. Pago</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden xl:table-cell">Canal</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">F. Compra</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">F. Actividad</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Importe</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resLoading ? (
                    <tr><td colSpan={10} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !resData?.length ? (
                    <tr><td colSpan={10} className="text-center py-12 text-white/30 text-sm">No hay reservas</td></tr>
                  ) : resData.map((res: any) => (
                    <tr key={res.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                      {/* Nº Reserva */}
                      <td className="px-4 py-3 shrink-0">
                        {res.reservationNumber ? (
                          <span className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-2 py-0.5 whitespace-nowrap">
                            {res.reservationNumber}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-white/20">—</span>
                        )}
                      </td>
                      {/* Cliente */}
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white">{res.customerName}</div>
                        <div className="text-xs text-white/40">{res.customerEmail}</div>
                        {res.customerPhone && <div className="text-xs text-white/30 mt-0.5">{res.customerPhone}</div>}
                        {res.merchantOrder && <div className="text-xs font-mono text-white/20 mt-0.5">{res.merchantOrder}</div>}
                      </td>
                      {/* Producto */}
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/60 truncate max-w-[200px]">{res.productName}</div>
                        {res.paymentMethod && (
                          <div className="text-xs text-white/30 mt-0.5">{getPaymentMethodLabel(res.paymentMethod)}</div>
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
                          "text-white/40 bg-white/5 border-white/10"
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
                        {res.channelDetail && (
                          <div className="text-[9px] text-white/30 mt-0.5 truncate max-w-[80px]">{res.channelDetail}</div>
                        )}
                      </td>
                      {/* F. Compra */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="text-xs text-white/50">{new Date(res.createdAt).toLocaleDateString("es-ES")}</div>
                      </td>
                      {/* F. Actividad */}
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {res.bookingDate ? (
                          <div className="text-xs text-white/70 font-medium">{res.bookingDate}</div>
                        ) : (
                          <span className="text-xs text-white/20">—</span>
                        )}
                      </td>
                      {/* Importe */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-orange-400">{((res.amountPaid ?? 0) / 100).toFixed(2)} €</span>
                        {res.amountPaid !== res.amountTotal && (
                          <div className="text-xs text-white/30">{((res.amountTotal ?? 0) / 100).toFixed(2)} € total</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {/* Ver detalles */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-sky-300 h-7 w-7 p-0"
                            onClick={() => setViewResId(res.id)}
                            title="Ver detalles">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                          {/* Editar */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-amber-300 h-7 w-7 p-0"
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
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-blue-300 h-7 w-7 p-0"
                            onClick={() => resendResMutation.mutate({ id: res.id })}
                            disabled={resendResMutation.isPending}
                            title="Reenviar confirmación al cliente">
                            {resendResMutation.isPending
                              ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              : <Send className="w-3.5 h-3.5" />}
                          </Button>
                          {/* Descargar PDF */}
                          <Button size="sm" variant="ghost"
                            className={`h-7 w-7 p-0 ${res.invoicePdfUrl ? "text-white/40 hover:text-emerald-300" : "text-white/15 cursor-not-allowed"}`}
                            onClick={() => res.invoicePdfUrl && window.open(res.invoicePdfUrl, "_blank")}
                            disabled={!res.invoicePdfUrl}
                            title={res.invoicePdfUrl ? "Descargar reserva en PDF" : "Sin PDF disponible"}>
                            <FileDown className="w-3.5 h-3.5" />
                          </Button>
                          {/* Generar factura — solo para TPV sin factura */}
                          {res.channel === "tpv" && !res.invoiceId && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-violet-300 h-7 w-7 p-0"
                              onClick={() => setGenInvoiceResId(res.id)}
                              title="Generar factura desde ticket TPV">
                              <FilePlus className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {/* Eliminar */}
                          <Button size="sm" variant="ghost" className="text-white/40 hover:text-red-400 h-7 w-7 p-0"
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
                        : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
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
                          : "bg-white/5 text-white/50 border-white/10 hover:bg-white/10"
                      }`}
                    >
                      {t === "all" ? "Todos los tipos" : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filtro por rango de fechas + accesos rápidos */}
              <div className="bg-white/3 border border-white/8 rounded-xl p-3 mb-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-white/50 text-xs">
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
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 text-white/60 border border-white/10 hover:bg-sky-600/30 hover:text-sky-300 hover:border-sky-500/40 transition-all">
                      {label}
                    </button>
                  ))}
                  {/* Inputs de fecha */}
                  <div className="flex items-center gap-2 ml-auto">
                    <input
                      type="date"
                      value={invoiceDateFrom}
                      onChange={e => setInvoiceDateFrom(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/70 focus:outline-none focus:border-sky-500/50 [color-scheme:dark]"
                    />
                    <span className="text-white/30 text-xs">→</span>
                    <input
                      type="date"
                      value={invoiceDateTo}
                      onChange={e => setInvoiceDateTo(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white/70 focus:outline-none focus:border-sky-500/50 [color-scheme:dark]"
                    />
                    {(invoiceDateFrom || invoiceDateTo) && (
                      <button onClick={() => { setInvoiceDateFrom(""); setInvoiceDateTo(""); }}
                        className="text-white/30 hover:text-white/60 transition-colors text-xs px-1.5 py-1 rounded hover:bg-white/5">
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Panel de resumen del período */}
              {invoicesData?.summary && (
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <div className="bg-white/3 border border-white/8 rounded-xl p-3 text-center">
                    <div className="text-xs text-white/40 mb-1">Facturas en período</div>
                    <div className="text-lg font-bold text-white">{invoicesData.total}</div>
                  </div>
                  <div className="bg-white/3 border border-white/8 rounded-xl p-3 text-center">
                    <div className="text-xs text-white/40 mb-1">Base imponible</div>
                    <div className="text-lg font-bold text-sky-400">{invoicesData.summary.subtotal.toFixed(2)} €</div>
                  </div>
                  <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 text-center">
                    <div className="text-xs text-orange-300/60 mb-1">Total (IVA incl.)</div>
                    <div className="text-lg font-bold text-orange-400">{invoicesData.summary.grandTotal.toFixed(2)} €</div>
                    <div className="text-xs text-white/30">IVA: {invoicesData.summary.tax.toFixed(2)} €</div>
                  </div>
                </div>
              )}

              <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/5">
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Número</th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Método pago</th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                      <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Total</th>
                      <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Fecha</th>
                      <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoicesLoading ? (
                      <tr><td colSpan={7} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                    ) : !invoicesData?.items?.length ? (
                      <tr><td colSpan={7} className="text-center py-12 text-white/30 text-sm">
                        <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No hay facturas
                      </td></tr>
                    ) : invoicesData.items.map((inv: any) => (
                      <tr key={inv.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-sm font-mono font-bold text-white">{inv.invoiceNumber}</div>
                          {inv.invoiceType === "abono" && (
                            <span className="text-xs text-violet-400 font-medium">Abono</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-white">{inv.clientName}</div>
                          <div className="text-xs text-white/40">{inv.clientEmail}</div>
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
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-orange-400">{Number(inv.total).toFixed(2)} €</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <div className="text-xs text-white/40">{new Date(inv.createdAt).toLocaleDateString("es-ES")}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {/* PDF */}
                            {inv.pdfUrl && (
                              <button onClick={() => downloadInvoicePdf(inv)} title="Descargar PDF"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                                <FileDown className="w-4 h-4" />
                              </button>
                            )}
                            {/* Reenviar */}
                            {["generada", "enviada"].includes(inv.status) && (
                              <button onClick={() => resendInvoiceMutation.mutate({ invoiceId: inv.id })} title="Reenviar por email"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-sky-400 transition-colors">
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {/* Confirmar pago manual */}
                            {["generada", "enviada"].includes(inv.status) && inv.invoiceType !== "abono" && (
                              <button onClick={() => setConfirmPaymentInvoiceId(inv.id)} title="Confirmar pago manual"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-emerald-400 transition-colors">
                                <CreditCard className="w-4 h-4" />
                              </button>
                            )}
                            {/* Generar abono */}
                            {inv.status === "cobrada" && inv.invoiceType !== "abono" && (
                              <button onClick={() => setCreditNoteInvoiceId(inv.id)} title="Generar factura de abono"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-violet-400 transition-colors">
                                <RotateCcw className="w-4 h-4" />
                              </button>
                            )}
                            {/* Anular */}
                            {!["anulada", "abonada"].includes(inv.status) && (
                              <button onClick={() => setVoidInvoiceId(inv.id)} title="Anular factura"
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-red-400 transition-colors">
                                <Ban className="w-4 h-4" />
                              </button>
                            )}
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
                    { label: "Total", value: anulKpis.total, color: "border-white/5" },
                    { label: "Recibidas", value: anulKpis.recibidas, color: "border-blue-500/20" },
                    { label: "En revisión", value: anulKpis.enRevision, color: "border-amber-500/20" },
                    { label: "Pend. docs", value: anulKpis.pendienteDocumentacion, color: "border-orange-500/20" },
                    { label: "Incidencias", value: anulKpis.incidencias, color: "border-red-500/20" },
                    { label: "Cerradas", value: anulKpis.cerradas, color: "border-gray-500/20" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className={`bg-white/3 border ${color} rounded-xl p-4`}>
                      <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-white">{value}</p>
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
                    <div key={label} className={`bg-white/3 border ${color} rounded-xl p-4`}>
                      <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
                      <p className="text-2xl font-bold text-white">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {/* Filtros */}
              <div className="flex flex-wrap gap-3">
                <Select value={anulOpFilter} onValueChange={setAnulOpFilter}>
                  <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white/70 text-xs h-9">
                    <SelectValue placeholder="Estado operativo" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-white/10">
                    <SelectItem value="all" className="text-white/70 text-xs">Todos los estados</SelectItem>
                    <SelectItem value="recibida" className="text-white/70 text-xs">Recibida</SelectItem>
                    <SelectItem value="en_revision" className="text-white/70 text-xs">En revisión</SelectItem>
                    <SelectItem value="pendiente_documentacion" className="text-white/70 text-xs">Pend. documentación</SelectItem>
                    <SelectItem value="pendiente_decision" className="text-white/70 text-xs">Pend. decisión</SelectItem>
                    <SelectItem value="resuelta" className="text-white/70 text-xs">Resuelta</SelectItem>
                    <SelectItem value="cerrada" className="text-white/70 text-xs">Cerrada</SelectItem>
                    <SelectItem value="incidencia" className="text-white/70 text-xs">Incidencia</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulResFilter} onValueChange={setAnulResFilter}>
                  <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white/70 text-xs h-9">
                    <SelectValue placeholder="Resolución" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-white/10">
                    <SelectItem value="all" className="text-white/70 text-xs">Toda resolución</SelectItem>
                    <SelectItem value="sin_resolver" className="text-white/70 text-xs">Sin resolver</SelectItem>
                    <SelectItem value="rechazada" className="text-white/70 text-xs">Rechazada</SelectItem>
                    <SelectItem value="aceptada_total" className="text-white/70 text-xs">Aceptada total</SelectItem>
                    <SelectItem value="aceptada_parcial" className="text-white/70 text-xs">Aceptada parcial</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulFinFilter} onValueChange={setAnulFinFilter}>
                  <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white/70 text-xs h-9">
                    <SelectValue placeholder="Estado financiero" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-white/10">
                    <SelectItem value="all" className="text-white/70 text-xs">Todo financiero</SelectItem>
                    <SelectItem value="sin_compensacion" className="text-white/70 text-xs">Sin compensación</SelectItem>
                    <SelectItem value="pendiente_devolucion" className="text-white/70 text-xs">Pend. devolución</SelectItem>
                    <SelectItem value="devuelta_economicamente" className="text-white/70 text-xs">Devuelta</SelectItem>
                    <SelectItem value="pendiente_bono" className="text-white/70 text-xs">Pend. bono</SelectItem>
                    <SelectItem value="compensada_bono" className="text-white/70 text-xs">Bono enviado</SelectItem>
                    <SelectItem value="incidencia_economica" className="text-white/70 text-xs">Incidencia ec.</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={anulReasonFilter} onValueChange={setAnulReasonFilter}>
                  <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white/70 text-xs h-9">
                    <SelectValue placeholder="Motivo" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1520] border-white/10">
                    <SelectItem value="all" className="text-white/70 text-xs">Todos los motivos</SelectItem>
                    <SelectItem value="meteorologicas" className="text-white/70 text-xs">Meteorológicas</SelectItem>
                    <SelectItem value="accidente" className="text-white/70 text-xs">Accidente</SelectItem>
                    <SelectItem value="enfermedad" className="text-white/70 text-xs">Enfermedad</SelectItem>
                    <SelectItem value="desistimiento" className="text-white/70 text-xs">Desistimiento</SelectItem>
                    <SelectItem value="otra" className="text-white/70 text-xs">Otra</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchAnul()}
                  className="gap-1.5 border-white/10 text-white/40 hover:text-white h-9"
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
              <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px]">
                    <thead>
                      <tr className="border-b border-white/8 bg-white/5">
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">#</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Solicitante</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Motivo</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Fecha actividad</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado op.</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Resolución</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Financiero</th>
                        <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Fecha</th>
                        <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {anulLoading && (
                        <tr>
                          <td colSpan={9} className="text-center py-12 text-white/30">
                            <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                          </td>
                        </tr>
                      )}
                      {!anulLoading && anulRows.length === 0 && (
                        <tr>
                          <td colSpan={9} className="text-center py-12">
                            <AlertTriangle className="w-8 h-8 text-white/20 mx-auto mb-2" />
                            <p className="text-white/30 text-sm">No hay solicitudes que coincidan con los filtros</p>
                          </td>
                        </tr>
                      )}
                      {anulRows.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer"
                          onClick={() => setSelectedAnulId(row.id)}
                        >
                          <td className="px-4 py-3 text-white/40 text-sm font-mono">#{row.id}</td>
                          <td className="px-4 py-3">
                            <p className="text-white text-sm font-medium">{row.fullName}</p>
                            {row.email && <p className="text-white/40 text-xs">{row.email}</p>}
                            {row.locator && <p className="text-white/30 text-xs font-mono">{row.locator}</p>}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {row.reason === "meteorologicas" && <CloudLightning className="w-4 h-4 text-blue-400" />}
                              {row.reason === "accidente" && <AlertTriangle className="w-4 h-4 text-red-400" />}
                              {row.reason === "enfermedad" && <HeartPulse className="w-4 h-4 text-pink-400" />}
                              {row.reason === "desistimiento" && <XCircle className="w-4 h-4 text-white/40" />}
                              {row.reason === "otra" && <HelpCircle className="w-4 h-4 text-white/40" />}
                              <span className="text-white/60 text-xs capitalize">{row.reason}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-white/60 text-sm">{row.activityDate}</td>
                          <td className="px-4 py-3">
                            <AnulOpBadge status={row.operationalStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulResBadge status={row.resolutionStatus} />
                          </td>
                          <td className="px-4 py-3">
                            <AnulFinBadge status={row.financialStatus} />
                          </td>
                          <td className="px-4 py-3 text-white/40 text-xs">
                            {new Date(row.createdAt).toLocaleDateString("es-ES")}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => setSelectedAnulId(row.id)}
                                className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                                title="Ver detalle"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteAnulId(row.id)}
                                className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors"
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
                  <div className="px-4 py-3 border-t border-white/5 text-xs text-white/30">
                    {anulRows.length} solicitud{anulRows.length !== 1 ? "es" : ""}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── TAB: Pagos Pendientes ─── */}
          {tab === "pagos_pendientes" && (
            <PagosPendientesTab />
          )}
        </div>
      </div>

      {/* Modals */}

      {/* ─── MODALES DE FACTURAS ──────────────────────────────────────────────── */}
      {/* Confirmar pago manual */}
      <Dialog open={confirmPaymentInvoiceId !== null} onOpenChange={(o) => !o && setConfirmPaymentInvoiceId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-emerald-400" /> Confirmar pago manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-white/60 text-xs mb-1.5 block">Método de pago</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as any)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-white/10">
                  <SelectItem value="transferencia" className="text-white">🏦 Transferencia bancaria</SelectItem>
                  <SelectItem value="efectivo" className="text-white">💵 Efectivo</SelectItem>
                  <SelectItem value="otro" className="text-white">❓ Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-white/40">Se marcará la factura como cobrada y se actualizará la reserva asociada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmPaymentInvoiceId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-violet-400" /> Generar factura de abono
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-white/60 text-xs mb-1.5 block">Motivo del abono *</Label>
              <Textarea
                value={creditNoteReason}
                onChange={(e) => setCreditNoteReason(e.target.value)}
                placeholder="Ej: Cancelación por condiciones meteorológicas"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none"
                rows={3}
              />
            </div>
            <p className="text-xs text-white/40">Se generará una factura de abono por el importe total. La factura original quedará marcada como abonada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setCreditNoteInvoiceId(null); setCreditNoteReason(""); }} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Anular factura
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Esta acción marcará la factura como anulada. No se puede deshacer. Para reembolsos, usa la opción de generar abono.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setVoidInvoiceId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar lead
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Esta acción es irreversible. Se eliminará el lead y toda su actividad asociada.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteLeadId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar presupuesto
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Esta acción es irreversible. Se eliminará el presupuesto y sus facturas asociadas.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteQuoteId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-orange-400" /> Enviar presupuesto al cliente
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Se enviará el presupuesto por email al cliente y se actualizará el estado a "Enviado".</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSendQuoteId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
      <Dialog open={confirmPaymentId !== null} onOpenChange={(o) => { if (!o) { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); } }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-white/60 text-sm">Selecciona el método de pago y completa los datos antes de confirmar.</p>
            {/* Selector de método */}
            <div className="grid grid-cols-3 gap-2">
              {(["tarjeta", "transferencia", "efectivo"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setConfirmPayMethodRow(m); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); }}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border text-xs font-medium transition-all ${
                    confirmPayMethodRow === m ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-white/50 hover:border-white/25 hover:text-white/80"
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
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">Nº operación TPV *</Label>
                <Input value={confirmPayTpvOp} onChange={(e) => setConfirmPayTpvOp(e.target.value)} placeholder="Ej: 000123456789" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm" />
              </div>
            )}
            {confirmPayMethodRow === "transferencia" && (
              <div className="space-y-2">
                <Label className="text-white/70 text-xs">Justificante de transferencia *</Label>
                {!confirmPayRowProofUrl ? (
                  <label className={`flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                    isUploadingRowProof ? "border-white/20 bg-white/5" : "border-white/20 bg-white/5 hover:border-emerald-500/50 hover:bg-emerald-500/5"
                  }`}>
                    <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={handleRowProofFileChange} disabled={isUploadingRowProof} />
                    {isUploadingRowProof ? (
                      <><RefreshCw className="w-5 h-5 text-white/40 animate-spin" /><span className="text-xs text-white/40">Subiendo...</span></>
                    ) : (
                      <><Upload className="w-5 h-5 text-white/40" /><span className="text-xs text-white/50">Haz clic o arrastra el justificante (PDF, JPG, PNG)</span></>
                    )}
                  </label>
                ) : (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs text-emerald-300 flex-1 truncate">Justificante subido correctamente</span>
                    <a href={confirmPayRowProofUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Ver</a>
                    <button onClick={() => { setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); }} className="text-white/30 hover:text-white/60 ml-1">×</button>
                  </div>
                )}
              </div>
            )}
            {confirmPayMethodRow === "efectivo" && (
              <div className="space-y-1.5">
                <Label className="text-white/70 text-xs">Justificación *</Label>
                <Textarea value={confirmPayNote} onChange={(e) => setConfirmPayNote(e.target.value)} placeholder="Ej: Cobrado en recepción el 31/03/2026" className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none" rows={2} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setConfirmPaymentId(null); setConfirmPayMethodRow("tarjeta"); setConfirmPayTpvOp(""); setConfirmPayNote(""); setConfirmPayRowProofUrl(null); setConfirmPayRowProofKey(null); }} className="border-white/15 text-white/60">Cancelar</Button>
            <Button
              size="sm"
              disabled={
                confirmPaymentMutation.isPending ||
                (confirmPayMethodRow === "tarjeta" && !confirmPayTpvOp.trim()) ||
                (confirmPayMethodRow === "transferencia" && !confirmPayRowProofUrl) ||
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
                });
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {confirmPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Confirmar y generar factura
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pago Pendiente desde fila (icono 5) — mismo flujo que el botón del modal de detalle */}
      <Dialog
        open={rowPendingPayQuoteId !== null}
        onOpenChange={(o) => { if (!o) { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); } }}
      >
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" /> Registrar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-white/60 text-sm">Se creará la reserva en estado <strong className="text-amber-400">pendiente de cobro</strong>, se registrará el pago pendiente y se enviará un email de recordatorio al cliente con la fecha límite.</p>
            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Fecha límite de pago *</Label>
              <Input
                type="date"
                value={rowPendingPayDueDate}
                onChange={(e) => setRowPendingPayDueDate(e.target.value)}
                className="bg-white/5 border-white/10 text-white text-sm"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-white/70 text-xs">Motivo / nota interna (opcional)</Label>
              <Textarea
                value={rowPendingPayReason}
                onChange={(e) => setRowPendingPayReason(e.target.value)}
                placeholder="Ej: Cliente confirma pago por transferencia la próxima semana..."
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm resize-none"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setRowPendingPayQuoteId(null); setRowPendingPayDueDate(""); setRowPendingPayReason(""); }} className="border-white/15 text-white/60">Cancelar</Button>
            <Button
              size="sm"
              disabled={!rowPendingPayDueDate || rowPendingPayMutation.isPending}
              onClick={() => {
                if (!rowPendingPayQuoteId || !rowPendingPayDueDate) return;
                // Buscamos el quote en la lista para obtener los datos del cliente
                const q = quotesData?.find((x: any) => x.id === rowPendingPayQuoteId);
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Marcar presupuesto como perdido
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Se marcará el presupuesto y la oportunidad como perdidos. Esta acción se puede revertir editando el estado manualmente.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMarkLostQuoteId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
            onEdit={(id, status) => {
              const resRow = resData?.find((r: any) => r.id === id);
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
          />
        )}
      </Dialog>

      {/* ─── EDITAR RESERVA (Fase 3) ──────────────────────────────────────────── */}
      <Dialog open={editResId !== null} onOpenChange={(o) => { if (!o) { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); } }}>
        <DialogContent className="max-w-xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="w-5 h-5 text-amber-400" /> Editar reserva
            </DialogTitle>
          </DialogHeader>

          {/* ── Cabecera con datos del cliente ── */}
          {editResData && (
            <div className="bg-white/5 rounded-xl p-3 mb-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="font-semibold text-white text-sm">{editResData.customerName}</div>
                {editResData.reservationNumber && (
                  <span className="font-mono text-xs font-bold text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded px-1.5 py-0.5">
                    {editResData.reservationNumber}
                  </span>
                )}
              </div>
              {editResData.customerEmail && (
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Mail className="w-3 h-3" />{editResData.customerEmail}
                </div>
              )}
              {editResData.customerPhone && (
                <div className="flex items-center gap-1.5 text-xs text-white/50">
                  <Phone className="w-3 h-3" />{editResData.customerPhone}
                </div>
              )}
              <div className="text-xs text-white/30 font-mono mt-0.5">{editResData.merchantOrder}</div>
            </div>
          )}

          <div className="space-y-4 py-1">

            {/* ── Estados separados ── */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Estado de reserva</label>
                <select
                  value={editResStatusReservation}
                  onChange={(e) => setEditResStatusReservation(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
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
                <label className="block text-xs text-white/50 mb-1.5">Estado de pago</label>
                <select
                  value={editResStatusPayment}
                  onChange={(e) => setEditResStatusPayment(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
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
                <label className="block text-xs text-white/50 mb-1.5">Canal</label>
                <select
                  value={editResChannel}
                  onChange={(e) => setEditResChannel(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500/50">
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
                <label className="block text-xs text-white/50 mb-1.5">Detalle canal (ej: Groupon)</label>
                <input
                  type="text"
                  value={editResChannelDetail}
                  onChange={(e) => setEditResChannelDetail(e.target.value)}
                  placeholder="Ej: Groupon, Booking..."
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/50" />
              </div>
            </div>

            {/* ── Notas internas ── */}
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Notas internas (opcional)</label>
              <textarea
                value={editResNotes}
                onChange={(e) => setEditResNotes(e.target.value)}
                rows={2}
                placeholder="Añade notas internas sobre esta reserva..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-orange-500/50 resize-none" />
            </div>

            {/* ── Cambio de fecha ── */}
            <div className="border border-amber-500/20 rounded-xl p-3 bg-amber-500/5">
              <button
                type="button"
                onClick={() => setShowChangeDateSection(!showChangeDateSection)}
                className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors w-full text-left">
                <Calendar className="w-4 h-4" />
                Cambiar fecha de actividad
                <span className="ml-auto text-xs text-white/30">{showChangeDateSection ? "▲ Ocultar" : "▼ Expandir"}</span>
              </button>
              {showChangeDateSection && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Nueva fecha de actividad *</label>
                    <input
                      type="date"
                      value={editResNewDate}
                      onChange={(e) => setEditResNewDate(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Motivo del cambio * (obligatorio)</label>
                    <textarea
                      value={editResDateReason}
                      onChange={(e) => setEditResDateReason(e.target.value)}
                      rows={2}
                      placeholder="Ej: Solicitud del cliente por condiciones meteorológicas..."
                      className="w-full bg-white/5 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-white placeholder-white/20 focus:outline-none focus:border-amber-500/50 resize-none" />
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
              <Button variant="outline" size="sm" onClick={() => { setEditResId(null); setEditResData(null); setShowChangeDateSection(false); }} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-400" /> Eliminar reserva
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Esta acción es irreversible. Se eliminará la reserva y sus datos asociados. Las facturas generadas no se eliminarán.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteResId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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

      {/* ─── Diálogo: Generar Factura desde TPV ───────────────────────────────── */}
      <Dialog open={genInvoiceResId !== null} onOpenChange={(o) => { if (!o) { setGenInvoiceResId(null); setGenInvoiceNif(""); setGenInvoiceAddress(""); } }}>
        <DialogContent className="max-w-md bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FilePlus className="w-5 h-5 text-violet-400" /> Generar Factura desde TPV
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-white/60">Se generará una factura formal a partir de los datos del ticket TPV. No se creará un nuevo expediente REAV; la factura se adjuntará al expediente existente.</p>
            <div className="space-y-2">
              <Label className="text-white/70 text-xs">NIF / DNI del cliente (opcional)</Label>
              <Input
                value={genInvoiceNif}
                onChange={(e) => setGenInvoiceNif(e.target.value)}
                placeholder="12345678A"
                className="bg-white/5 border-white/15 text-white text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-white/70 text-xs">Dirección de facturación (opcional)</Label>
              <Input
                value={genInvoiceAddress}
                onChange={(e) => setGenInvoiceAddress(e.target.value)}
                placeholder="Calle, número, CP, ciudad"
                className="bg-white/5 border-white/15 text-white text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setGenInvoiceResId(null); setGenInvoiceNif(""); setGenInvoiceAddress(""); }} className="border-white/15 text-white/60">Cancelar</Button>
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
        />
      )}
      {/* Confirmar eliminación anulación */}
      <Dialog open={deleteAnulId !== null} onOpenChange={(o) => !o && setDeleteAnulId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle>Eliminar solicitud</DialogTitle>
          </DialogHeader>
          <p className="text-white/60 text-sm">¿Seguro que quieres eliminar esta solicitud de anulación? Esta acción no se puede deshacer.</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteAnulId(null)} className="border-white/10 text-white/60">
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
        </AdminLayout>
  );
}

// ─── PAGOS PENDIENTES TAB ────────────────────────────────────────────────────
function PagosPendientesTab() {
  const utils = trpc.useUtils();
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<"transferencia" | "efectivo" | "tarjeta">("transferencia");
  const [cancelId, setCancelId] = useState<number | null>(null);

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

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      pending:   { label: "Pendiente",  cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
      overdue:   { label: "Vencido",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
      confirmed: { label: "Confirmado", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
      cancelled: { label: "Cancelado",  cls: "bg-white/10 text-white/40 border-white/10" },
    };
    const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/40 border-white/10" };
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
          <p className="text-white/40 text-sm">{total} registro{total !== 1 ? "s" : ""} en total</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="bg-white/5 border-white/10 text-white h-8 text-xs w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0d1526] border-white/10">
              <SelectItem value="all" className="text-white text-xs">Todos</SelectItem>
              <SelectItem value="pending" className="text-white text-xs">Pendiente</SelectItem>
              <SelectItem value="overdue" className="text-white text-xs">Vencido</SelectItem>
              <SelectItem value="confirmed" className="text-white text-xs">Confirmado</SelectItem>
              <SelectItem value="cancelled" className="text-white text-xs">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => refetch()}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-white/8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-white/5">
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">#</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Presupuesto</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Importe</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Vencimiento</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Motivo</th>
                <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-white/30">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <Clock className="w-8 h-8 text-white/20 mx-auto mb-2" />
                    <p className="text-white/30 text-sm">No hay pagos pendientes</p>
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const dueDate = row.dueDate ? new Date(row.dueDate) : null;
                const isOverdue = dueDate && dueDate < new Date() && row.status === "pending";
                return (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors"
                  >
                    <td className="px-4 py-3 text-white/40 text-sm font-mono">#{row.id}</td>
                    <td className="px-4 py-3">
                      <p className="text-white text-sm font-medium">{row.clientName}</p>
                      {row.clientEmail && <p className="text-white/40 text-xs">{row.clientEmail}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {row.quoteId ? (
                        <span className="text-white/60 text-xs font-mono">PRES-{row.quoteId}</span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-semibold text-sm">
                        {(row.amountCents / 100).toFixed(2)} €
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {dueDate ? (
                        <span className={`text-xs ${isOverdue ? "text-red-400 font-semibold" : "text-white/60"}`}>
                          {dueDate.toLocaleDateString("es-ES")}
                          {isOverdue && " ⚠"}
                        </span>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/50 text-xs max-w-[160px] truncate">
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-white/60 text-xs mb-1.5 block">Método de pago</Label>
              <Select value={confirmMethod} onValueChange={(v) => setConfirmMethod(v as any)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1526] border-white/10">
                  <SelectItem value="transferencia" className="text-white">🏦 Transferencia bancaria</SelectItem>
                  <SelectItem value="tarjeta" className="text-white">💳 Tarjeta</SelectItem>
                  <SelectItem value="efectivo" className="text-white">💵 Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-white/40">Se marcará el pago como confirmado y se actualizará la reserva asociada.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmId(null)} className="border-white/15 text-white/60">Cancelar</Button>
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
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Cancelar pago pendiente
            </DialogTitle>
          </DialogHeader>
          <p className="text-white/60 text-sm py-2">¿Seguro que quieres cancelar este pago pendiente? El cliente no recibirá más recordatorios.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelId(null)} className="border-white/15 text-white/60">Volver</Button>
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
    </div>
  );
}
