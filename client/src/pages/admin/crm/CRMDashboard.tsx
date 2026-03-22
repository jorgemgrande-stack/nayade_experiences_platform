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
} from "lucide-react";

// ─── TYPES ───────────────────────────────────────────────────────────────────

type Tab = "leads" | "quotes" | "reservations" | "invoices";

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
              <span className="text-white/50">Fecha preferida</span>
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
        {/* Botón Generar presupuesto automático — solo visible si hay actividades */}
        {Array.isArray(lead.activitiesJson) && lead.activitiesJson.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:border-emerald-500/60"
            onClick={() => generateQuote.mutate({ leadId })}
            disabled={generateQuote.isPending}
            title="Genera automáticamente las líneas del presupuesto con los precios de las variantes seleccionadas"
          >
            {generateQuote.isPending
              ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
              : <Sparkles className="w-4 h-4 mr-1" />}
            Generar presupuesto
          </Button>
        )}
        <Button
          size="sm"
          className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white"
          onClick={() => { onClose(); onConvert(leadId, undefined); }}
        >
          <FileText className="w-4 h-4 mr-1" /> Crear Presupuesto
        </Button>
      </DialogFooter>
    </DialogContent>
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
  const [form, setForm] = useState<{
    name: string; email: string; phone: string; selectedCategory: string;
    selectedProduct: string; message: string; priority: string; opportunityStatus: string;
  } | null>(null);

  // Populate form once data loads
  if (data && !form) {
    const { lead } = data;
    setForm({
      name: lead.name ?? "",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      selectedCategory: lead.selectedCategory ?? "",
      selectedProduct: lead.selectedProduct ?? "",
      message: lead.message ?? "",
      priority: lead.priority ?? "media",
      opportunityStatus: lead.opportunityStatus ?? "nueva",
    });
  }

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
      <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-lg bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-white flex items-center gap-2">
          <Pencil className="w-4 h-4 text-orange-400" /> Editar Lead
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-white/60 text-xs">Nombre</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Email</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Teléfono</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-white/60 text-xs">Categoría</Label>
            <Input value={form.selectedCategory} onChange={(e) => setForm({ ...form, selectedCategory: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Producto / Experiencia</Label>
            <Input value={form.selectedProduct} onChange={(e) => setForm({ ...form, selectedProduct: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
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
          <div className="col-span-2">
            <Label className="text-white/60 text-xs">Mensaje / Comentarios</Label>
            <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="bg-white/5 border-white/10 text-white mt-1 resize-none h-16 text-sm" />
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose} className="border-white/15 text-white/60">Cancelar</Button>
        <Button
          size="sm"
          onClick={() => updateLead.mutate({
              id: leadId,
              name: form.name,
              email: form.email,
              phone: form.phone,
              selectedCategory: form.selectedCategory,
              selectedProduct: form.selectedProduct,
              message: form.message,
              priority: form.priority as "baja" | "media" | "alta",
              opportunityStatus: form.opportunityStatus as "nueva" | "enviada" | "ganada" | "perdida",
            })}
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
  const [items, setItems] = useState([{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  // Búsqueda de clientes existentes
  const { data: clientSuggestions } = trpc.crm.clients.list.useQuery(
    { search: clientSearch, limit: 6 },
    { enabled: clientSearch.length >= 2 }
  );

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
      discount: 0,
      taxRate,
      total,
      validUntil,
      notes: notes || undefined,
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
            {showClientSuggestions && (clientSuggestions?.items?.length ?? 0) > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#0d1526] border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto">
                {clientSuggestions!.items.map((c: any) => (
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
            <span className="col-span-5">Descripción</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <ProductSearchInput
                    value={item.description}
                    onChange={(v) => updateItem(idx, "description", v)}
                    onSelect={(p) => {
                      setItems((prev) => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const unitPrice = Number(p.basePrice);
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity };
                      }));
                    }}
                  />
                </div>
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className="col-span-2 text-right text-sm font-semibold text-orange-400">{item.total.toFixed(2)} €</div>
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
          <div className="flex justify-between text-sm text-white/60"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          <div className="flex justify-between text-sm text-white/60"><span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span></div>
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
  const [items, setItems] = useState([
    { description: "", quantity: 1, unitPrice: 0, total: 0 },
  ]);
  const [sendAfterCreate, setSendAfterCreate] = useState(false);

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

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
      discount: 0,
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
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}
            >
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="text-xs text-white/30 grid grid-cols-12 gap-2 mb-1">
            <span className="col-span-5">Descripción</span>
            <span className="col-span-2 text-center">Cant.</span>
            <span className="col-span-2 text-right">P.Unit.</span>
            <span className="col-span-2 text-right">Total</span>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <ProductSearchInput
                    value={item.description}
                    onChange={(v) => updateItem(idx, "description", v)}
                    onSelect={(p) => {
                      setItems((prev) => prev.map((it, i) => {
                        if (i !== idx) return it;
                        const unitPrice = Number(p.basePrice);
                        return { ...it, description: p.title, unitPrice, total: unitPrice * it.quantity };
                      }));
                    }}
                  />
                </div>
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
                <div className="col-span-2 text-right text-sm font-semibold text-orange-400">
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

        {/* Totals */}
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-white/60">
            <span>Subtotal</span><span>{subtotal.toFixed(2)} €</span>
          </div>
          <div className="flex justify-between text-sm text-white/60">
            <span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span>
          </div>
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
  const [items, setItems] = useState<{ description: string; quantity: number; unitPrice: number; total: number }[]>([]);
  const [initialized, setInitialized] = useState(false);

  if (data && !initialized) {
    const q = data.quote;
    setTitle(q.title ?? "");
    setConditions(q.conditions ?? "");
    setNotes(q.notes ?? "");
    setTaxRate(q.tax ? parseFloat(String(q.tax)) : 21);
    setValidUntil(q.validUntil ? new Date(q.validUntil).toISOString().split("T")[0] : "");
    const rawItems = (q.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];
    setItems(rawItems.length > 0 ? rawItems : [{ description: "", quantity: 1, unitPrice: 0, total: 0 }]);
    setInitialized(true);
  }

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  const updateItem = (idx: number, field: string, value: string | number) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") updated.total = Number(updated.quantity) * Number(updated.unitPrice);
      return updated;
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
              onClick={() => setItems((p) => [...p, { description: "", quantity: 1, unitPrice: 0, total: 0 }])}>
              <Plus className="w-3 h-3 mr-1" /> Añadir línea
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-5 bg-white/5 border-white/10 text-white placeholder:text-white/30 text-sm" placeholder="Descripción"
                  value={item.description} onChange={(e) => updateItem(idx, "description", e.target.value)} />
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-center" type="number" min={1}
                  value={item.quantity} onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))} />
                <Input className="col-span-2 bg-white/5 border-white/10 text-white text-sm text-right" type="number" min={0} step={0.01}
                  value={item.unitPrice} onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))} />
                <div className="col-span-2 text-right text-sm font-semibold text-orange-400">{item.total.toFixed(2)} €</div>
                <Button size="sm" variant="ghost" className="col-span-1 text-white/30 hover:text-red-400 p-1"
                  onClick={() => setItems((p) => p.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white/5 rounded-xl p-4 space-y-1.5">
          <div className="flex justify-between text-sm text-white/60"><span>Subtotal</span><span>{subtotal.toFixed(2)} €</span></div>
          <div className="flex justify-between text-sm text-white/60"><span>IVA ({taxRate}%)</span><span>{taxAmount.toFixed(2)} €</span></div>
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
  const items = (quote.items as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];

  return (
    <DialogContent className="max-w-2xl bg-[#0d1526] border-white/10 text-white max-h-[90vh] overflow-y-auto">
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
              {items.map((item, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-4 py-2.5 text-sm text-white/80">{item.description}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-center">{item.quantity}</td>
                  <td className="px-4 py-2.5 text-sm text-white/60 text-right">{Number(item.unitPrice).toFixed(2)} €</td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-orange-400 text-right">{Number(item.total).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-white/10 space-y-1">
            {Number(quote.discount) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>Descuento</span><span>-{Number(quote.discount).toFixed(2)} €</span>
              </div>
            )}
            {Number(quote.tax) > 0 && (
              <div className="flex justify-between text-sm text-white/50">
                <span>IVA</span><span>{Number(quote.tax).toFixed(2)} €</span>
              </div>
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

      <DialogFooter className="flex gap-2 flex-wrap pt-2 border-t border-white/10">
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

        {/* Confirmar Pago */}
        {(quote.status === "enviado" || quote.status === "borrador") && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
            onClick={() => confirmPayment.mutate({ quoteId })}
            disabled={confirmPayment.isPending}
          >
            {confirmPayment.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
            Confirmar Pago
          </Button>
        )}

        {/* Convertir a Reserva sin pago */}
        {(quote.status === "enviado" || quote.status === "borrador") && (
          <Button
            size="sm"
            variant="outline"
            className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10 text-xs"
            onClick={() => convertToReservation.mutate({ quoteId })}
            disabled={convertToReservation.isPending}
          >
            {convertToReservation.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5 mr-1" />}
            Reserva s/pago
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
  );
}

// ─── MAIN CRM DASHBOARD ───────────────────────────────────────────────────────

export default function CRMDashboard() {
  const [tab, setTab] = useState<Tab>("leads");
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
  const [convertReservationId, setConvertReservationId] = useState<number | null>(null);
  const [markLostQuoteId, setMarkLostQuoteId] = useState<number | null>(null);
  const [showDirectQuoteModal, setShowDirectQuoteModal] = useState(false);

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
    search: search || undefined,
    limit: 50,
    offset: 0,
  }), [filterStatus, search, tab]);

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
          {/* Botón Nuevo Presupuesto — visible solo en el tab de presupuestos */}
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

        {/* Table */}
        <div className="px-6 pb-8">
          {tab === "leads" && (
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/8 bg-white/5">
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">Fecha pref.</th>
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
                          {/* Convertir a reserva sin pago (enviado) */}
                          {quote.status === "enviado" && (
                            <Button size="sm" variant="ghost" className="text-white/40 hover:text-purple-300 h-7 w-7 p-0" onClick={() => setConvertReservationId(quote.id)} title="Convertir a reserva (pendiente cobro)">
                              <CalendarCheck className="w-3.5 h-3.5" />
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
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Cliente</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden md:table-cell">Producto</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium">Estado</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden lg:table-cell">Factura</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Importe</th>
                    <th className="text-left px-4 py-3 text-xs text-white/40 font-medium hidden sm:table-cell">Fecha</th>
                    <th className="text-right px-4 py-3 text-xs text-white/40 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {resLoading ? (
                    <tr><td colSpan={7} className="text-center py-12 text-white/30"><RefreshCw className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                  ) : !resData?.length ? (
                    <tr><td colSpan={7} className="text-center py-12 text-white/30 text-sm">No hay reservas</td></tr>
                  ) : resData.map((res: any) => (
                    <tr key={res.id} className="border-t border-white/5 hover:bg-white/3 transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-white">{res.customerName}</div>
                        <div className="text-xs text-white/40">{res.customerEmail}</div>
                        {res.reservationRef && <div className="text-xs font-mono text-white/30 mt-0.5">{res.reservationRef}</div>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-sm text-white/60 truncate max-w-[200px]">{res.productName}</div>
                        {res.paymentMethod && (
                          <div className="text-xs text-white/30 mt-0.5">{getPaymentMethodLabel(res.paymentMethod)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
                          res.status === "paid" || res.status === "confirmed" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                          res.status === "pending_payment" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                          res.status === "cancelled" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                          "bg-slate-500/15 text-slate-400 border-slate-500/30"
                        }`}>
                          {res.status === "paid" || res.status === "confirmed" ? "✅ Confirmada" :
                           res.status === "pending_payment" ? "⏳ Pendiente" :
                           res.status === "cancelled" ? "❌ Cancelada" : res.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {res.invoiceNumber ? (
                          <button
                            onClick={() => { setTab("invoices"); setInvoiceSearch(res.invoiceNumber); }}
                            className="text-xs font-mono text-sky-400 hover:text-sky-300 transition-colors flex items-center gap-1">
                            <Receipt className="w-3 h-3" />{res.invoiceNumber}
                          </button>
                        ) : (
                          <span className="text-xs text-white/20">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-orange-400">{((res.amountPaid ?? 0) / 100).toFixed(2)} €</span>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="text-xs text-white/40">{new Date(res.createdAt).toLocaleDateString("es-ES")}</div>
                        {res.arrivalDate && (
                          <div className="text-xs text-white/25">✈️ {new Date(res.arrivalDate).toLocaleDateString("es-ES")}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {/* Ver factura */}
                          {res.invoicePdfUrl && (
                            <button onClick={() => window.open(res.invoicePdfUrl, "_blank")} title="Descargar factura PDF"
                              className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors">
                              <FileDown className="w-4 h-4" />
                            </button>
                          )}
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
                          <div className="text-xs text-white/50">
                            {inv.paymentMethod ? getPaymentMethodLabel(inv.paymentMethod) : <span className="text-white/20">—</span>}
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

      {/* Confirm Payment */}
      <Dialog open={confirmPaymentId !== null} onOpenChange={(o) => !o && setConfirmPaymentId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Confirmar pago recibido
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Se marcará el presupuesto como pagado, se generará la reserva y la factura PDF automáticamente.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmPaymentId(null)} className="border-white/15 text-white/60">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => confirmPaymentId !== null && confirmPaymentMutation.mutate({ quoteId: confirmPaymentId })}
              disabled={confirmPaymentMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {confirmPaymentMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle className="w-4 h-4 mr-1" />}
              Confirmar pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Reservation (no payment) */}
      <Dialog open={convertReservationId !== null} onOpenChange={(o) => !o && setConvertReservationId(null)}>
        <DialogContent className="max-w-sm bg-[#0d1526] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-purple-400" /> Convertir a reserva
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60 py-2">Se creará una reserva con estado <strong className="text-amber-400">pendiente de cobro</strong>. La oportunidad se marcará como ganada. Podrás confirmar el pago más adelante.</p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConvertReservationId(null)} className="border-white/15 text-white/60">Cancelar</Button>
            <Button
              size="sm"
              onClick={() => convertReservationId !== null && convertReservationMutation.mutate({ quoteId: convertReservationId })}
              disabled={convertReservationMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              {convertReservationMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-1" /> : <CalendarCheck className="w-4 h-4 mr-1" />}
              Crear reserva
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
    </AdminLayout>
  );
}
