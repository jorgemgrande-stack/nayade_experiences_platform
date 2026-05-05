import React, { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
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
  BarChart3, Eye, EyeOff, Send, Pause, Play, XCircle, CheckCircle2,
  MessageSquare, Phone, MessageCircle, StickyNote, Settings, List,
  History, ChevronRight, RefreshCw, Pencil, Trash2, Plus, TrendingUp,
  Users, Clock, AlertTriangle, Ban, Target, ArrowRight,
  Bot, Bell, BellOff, Volume2, VolumeX, Mail, MailOpen, SendHorizonal,
} from "lucide-react";
import { NOTIF_POPUP_KEY, NOTIF_SOUND_KEY } from "@/components/WhatsAppNotification";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "open" | "rules" | "history" | "settings";

const COMMERCIAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending_followup: { label: "Pendiente",       color: "text-slate-300",   bg: "bg-slate-500/15",   border: "border-slate-500/30" },
  reminder_1_sent:  { label: "Recordatorio 1",  color: "text-purple-300",  bg: "bg-purple-500/15",  border: "border-purple-500/30" },
  reminder_2_sent:  { label: "Recordatorio 2",  color: "text-violet-300",  bg: "bg-violet-500/15",  border: "border-violet-500/30" },
  reminder_3_sent:  { label: "Rec. 3",          color: "text-indigo-300",  bg: "bg-indigo-500/15",  border: "border-indigo-500/30" },
  interested:       { label: "Interesado",       color: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/30" },
  paused:           { label: "Pausado",          color: "text-amber-300",   bg: "bg-amber-500/15",   border: "border-amber-500/30" },
  lost:             { label: "Perdido",          color: "text-red-300",     bg: "bg-red-500/15",     border: "border-red-500/30" },
  converted:        { label: "Convertido",       color: "text-green-300",   bg: "bg-green-500/15",   border: "border-green-500/30" },
  discarded:        { label: "Descartado",       color: "text-zinc-400",    bg: "bg-zinc-500/15",    border: "border-zinc-500/30" },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  const cfg = COMMERCIAL_STATUS_CONFIG[status ?? "pending_followup"] ?? COMMERCIAL_STATUS_CONFIG.pending_followup;
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function daysSince(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: number | string; sub?: string; color: string; icon: React.ElementType;
}) {
  return (
    <div className={`rounded-xl border border-foreground/[0.08] bg-background p-4 flex flex-col gap-1`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground/50 font-medium uppercase tracking-wide">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-foreground/40">{sub}</div>}
    </div>
  );
}

// ─── Action Row ───────────────────────────────────────────────────────────────

function QuoteActionRow({ quote, onAction }: {
  quote: any;
  onAction: (action: string, quote: any) => void;
}) {
  const days = daysSince(quote.sentAt);
  const cfg = COMMERCIAL_STATUS_CONFIG[quote.commercialStatus ?? "pending_followup"] ?? COMMERCIAL_STATUS_CONFIG.pending_followup;
  return (
    <tr className="border-b border-foreground/[0.05] hover:bg-foreground/[0.02] transition-colors">
      <td className="px-3 py-2.5">
        <div className="font-mono text-xs text-orange-400 font-bold">{quote.quoteNumber}</div>
        {quote.title && <div className="text-[10px] text-foreground/40 truncate max-w-[120px]">{quote.title}</div>}
      </td>
      <td className="px-3 py-2.5">
        <div className="text-xs font-medium text-foreground/80 truncate max-w-[120px]">{quote.clientName ?? "—"}</div>
        <div className="text-[10px] text-foreground/40 truncate max-w-[120px]">{quote.clientEmail ?? ""}</div>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <div className="text-xs text-foreground/60">{fmtDate(quote.sentAt)}</div>
        {days !== null && <div className="text-[10px] text-foreground/35">Hace {days}d</div>}
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-xs font-bold text-orange-400">{Number(quote.total ?? 0).toFixed(2)} €</span>
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={quote.commercialStatus} />
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        {quote.viewedAt
          ? <span className="inline-flex items-center gap-1 text-[10px] text-sky-400"><Eye className="w-3 h-3" /> {fmtDate(quote.viewedAt)}</span>
          : <span className="inline-flex items-center gap-1 text-[10px] text-foreground/30"><EyeOff className="w-3 h-3" /> No visto</span>
        }
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        <span className="text-xs text-foreground/50">{quote.trackingReminderCount ?? quote.reminderCount ?? 0}</span>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-0.5 justify-end">
          {quote.paymentLinkUrl && (
            <a href={quote.paymentLinkUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-sky-400 transition-colors" title="Ver presupuesto">
              <Eye className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={() => onAction("remind", quote)} title="Enviar recordatorio manual"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-purple-400 transition-colors">
            <Send className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onAction("note", quote)} title="Añadir nota"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-amber-400 transition-colors">
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          {quote.reminderPaused
            ? <button onClick={() => onAction("resume", quote)} title="Reanudar recordatorios"
                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-amber-400 hover:text-emerald-400 transition-colors">
                <Play className="w-3.5 h-3.5" />
              </button>
            : <button onClick={() => onAction("pause", quote)} title="Pausar recordatorios"
                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-amber-400 transition-colors">
                <Pause className="w-3.5 h-3.5" />
              </button>
          }
          <button onClick={() => onAction("interested", quote)} title="Marcar como interesado"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-emerald-400 transition-colors">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onAction("lost", quote)} title="Marcar como perdido"
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-red-400 transition-colors">
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CommercialFollowupDashboard() {
  const searchStr = useSearch();
  const tabFromUrl = (): Tab => {
    try {
      const t = new URLSearchParams(searchStr).get("tab");
      if (t === "dashboard" || t === "open" || t === "rules" || t === "history" || t === "settings") return t;
    } catch {}
    return "dashboard";
  };
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const utils = trpc.useUtils();

  // ── Modal state ──────────────────────────────────────────────────────────
  const [remindQuote, setRemindQuote] = useState<any>(null);
  const [noteQuote, setNoteQuote] = useState<any>(null);
  const [lostQuote, setLostQuote] = useState<any>(null);
  const [pauseQuote, setPauseQuote] = useState<any>(null);
  const [editRule, setEditRule] = useState<any>(null);
  const [showNewRule, setShowNewRule] = useState(false);

  const [remindSubject, setRemindSubject] = useState("");
  const [remindBody, setRemindBody] = useState("");
  const [noteText, setNoteText] = useState("");
  const [noteChannel, setNoteChannel] = useState<"email" | "phone" | "whatsapp" | "internal">("internal");
  const [lostReason, setLostReason] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  // ── Open quotes filters ──────────────────────────────────────────────────
  const [openSearch, setOpenSearch] = useState("");
  const [openStatus, setOpenStatus] = useState("all");
  const [openViewed, setOpenViewed] = useState<"all" | "yes" | "no">("all");

  // ── Rule form ────────────────────────────────────────────────────────────
  const [ruleForm, setRuleForm] = useState({
    name: "", isActive: true, delayHours: 24,
    triggerFrom: "quote_sent_at" as "quote_sent_at" | "last_reminder_at",
    onlyIfNotViewed: false, allowIfViewedButUnpaid: true,
    maxSendsPerQuoteForThisRule: 1, emailSubject: "", emailBody: "", sortOrder: 0,
  });

  // ─── Notif settings (localStorage) ───────────────────────────────────────
  const [popupDisabled, setPopupDisabledState] = useState(() => localStorage.getItem(NOTIF_POPUP_KEY) === "true");
  const [soundDisabled, setSoundDisabledState] = useState(() => localStorage.getItem(NOTIF_SOUND_KEY) === "true");

  const setPopupDisabled = (v: boolean) => { localStorage.setItem(NOTIF_POPUP_KEY, String(v)); setPopupDisabledState(v); };
  const setSoundDisabled = (v: boolean) => { localStorage.setItem(NOTIF_SOUND_KEY, String(v)); setSoundDisabledState(v); };

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: dashboard, isLoading: dashLoading, refetch: refetchDash } =
    trpc.commercialFollowup.getDashboard.useQuery(undefined, { enabled: tab === "dashboard" });

  const { data: whatsappStats } = trpc.ghlInbox.getStats.useQuery(undefined, {
    enabled: tab === "dashboard", refetchInterval: 15000,
  });

  const { data: vapiStats } = trpc.vapiCalls.getStats.useQuery(undefined, {
    enabled: tab === "dashboard", refetchInterval: 15000,
  });

  const { data: emailStats } = trpc.emailInbox.getStats.useQuery({}, {
    enabled: tab === "dashboard", refetchInterval: 30000,
  });

  const { data: openData, isLoading: openLoading, refetch: refetchOpen } =
    trpc.commercialFollowup.listOpen.useQuery(
      { search: openSearch || undefined, commercialStatus: openStatus === "all" ? undefined : openStatus || undefined, viewed: openViewed, limit: 100, offset: 0 },
      { enabled: tab === "open" }
    );

  const { data: rules, refetch: refetchRules } =
    trpc.commercialFollowup.listRules.useQuery(undefined, { enabled: tab === "rules" });

  const { data: historyData, isLoading: histLoading } =
    trpc.commercialFollowup.listCommunications.useQuery({ limit: 200, offset: 0 }, { enabled: tab === "history" });

  const { data: settings, refetch: refetchSettings } =
    trpc.commercialFollowup.getSettings.useQuery(undefined, { enabled: tab === "settings" });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const sendManualReminder = trpc.commercialFollowup.sendManualReminder.useMutation({
    onSuccess: () => { toast.success("Recordatorio enviado"); setRemindQuote(null); refetchDash(); refetchOpen(); },
    onError: (e) => toast.error(e.message),
  });

  const addNote = trpc.commercialFollowup.addNote.useMutation({
    onSuccess: () => { toast.success("Nota añadida"); setNoteQuote(null); setNoteText(""); },
    onError: (e) => toast.error(e.message),
  });

  const updateStatus = trpc.commercialFollowup.updateCommercialStatus.useMutation({
    onSuccess: () => { toast.success("Estado actualizado"); setLostQuote(null); setLostReason(""); refetchDash(); refetchOpen(); },
    onError: (e) => toast.error(e.message),
  });

  const pauseReminders = trpc.commercialFollowup.pauseReminders.useMutation({
    onSuccess: () => { toast.success("Recordatorios pausados"); setPauseQuote(null); setPauseReason(""); refetchDash(); refetchOpen(); },
    onError: (e) => toast.error(e.message),
  });

  const resumeReminders = trpc.commercialFollowup.resumeReminders.useMutation({
    onSuccess: () => { toast.success("Recordatorios reanudados"); refetchDash(); refetchOpen(); },
    onError: (e) => toast.error(e.message),
  });

  const createRule = trpc.commercialFollowup.createRule.useMutation({
    onSuccess: () => { toast.success("Regla creada"); setShowNewRule(false); refetchRules(); resetRuleForm(); },
    onError: (e) => toast.error(e.message),
  });

  const updateRule = trpc.commercialFollowup.updateRule.useMutation({
    onSuccess: () => { toast.success("Regla actualizada"); setEditRule(null); refetchRules(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteRule = trpc.commercialFollowup.deleteRule.useMutation({
    onSuccess: () => { toast.success("Regla eliminada"); refetchRules(); },
    onError: (e) => toast.error(e.message),
  });

  const updateSettings = trpc.commercialFollowup.updateSettings.useMutation({
    onSuccess: () => { toast.success("Configuración guardada"); refetchSettings(); },
    onError: (e) => toast.error(e.message),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleAction(action: string, quote: any) {
    if (action === "remind") { setRemindQuote(quote); setRemindSubject(""); setRemindBody(""); }
    if (action === "note") { setNoteQuote(quote); setNoteText(""); }
    if (action === "lost") { setLostQuote(quote); setLostReason(""); }
    if (action === "pause") { setPauseQuote(quote); setPauseReason(""); }
    if (action === "resume") resumeReminders.mutate({ quoteId: quote.id });
    if (action === "interested") updateStatus.mutate({ quoteId: quote.id, status: "interested" });
  }

  function resetRuleForm() {
    setRuleForm({ name: "", isActive: true, delayHours: 24, triggerFrom: "quote_sent_at", onlyIfNotViewed: false, allowIfViewedButUnpaid: true, maxSendsPerQuoteForThisRule: 1, emailSubject: "", emailBody: "", sortOrder: 0 });
  }

  function openEditRule(rule: any) {
    setEditRule(rule);
    setRuleForm({
      name: rule.name, isActive: rule.isActive, delayHours: rule.delayHours,
      triggerFrom: rule.triggerFrom, onlyIfNotViewed: rule.onlyIfNotViewed,
      allowIfViewedButUnpaid: rule.allowIfViewedButUnpaid,
      maxSendsPerQuoteForThisRule: rule.maxSendsPerQuoteForThisRule,
      emailSubject: rule.emailSubject, emailBody: rule.emailBody, sortOrder: rule.sortOrder,
    });
  }

  // ─── Tab Navigation ───────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: "Panel", icon: BarChart3 },
    { id: "open", label: "Presupuestos abiertos", icon: List },
    { id: "rules", label: "Reglas", icon: Settings },
    { id: "history", label: "Historial", icon: History },
    { id: "settings", label: "Configuración", icon: Settings },
  ];

  const kpis = dashboard?.kpis;

  // ─── Settings form local state ────────────────────────────────────────────
  const [sEnabled, setSEnabled] = useState<boolean | null>(null);
  const [sMax, setSMax] = useState<number | null>(null);
  const [sStart, setSStart] = useState<string | null>(null);
  const [sEnd, setSEnd] = useState<string | null>(null);
  const [sDays, setSDays] = useState<number | null>(null);
  const [sCc, setSCc] = useState<string | null>(null);

  React.useEffect(() => {
    if (settings) {
      setSEnabled(settings.enabled);
      setSMax(settings.maxTotalRemindersPerQuote);
      setSStart(settings.allowedSendStart);
      setSEnd(settings.allowedSendEnd);
      setSDays(settings.stopAfterDays);
      setSCc(settings.internalCcEmail ?? "");
    }
  }, [settings]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-foreground">Atención Comercial</h1>
            <p className="text-sm text-foreground/50">Seguimiento de presupuestos no convertidos</p>
          </div>
          <button onClick={() => { refetchDash(); refetchOpen(); }}
            className="p-2 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-foreground transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mb-6 border-b border-foreground/[0.08] pb-0">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                tab === t.id
                  ? "border-orange-400 text-orange-400"
                  : "border-transparent text-foreground/50 hover:text-foreground hover:border-foreground/20"
              }`}>
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: DASHBOARD ──────────────────────────────────────────────── */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            {dashLoading ? (
              <div className="flex items-center justify-center h-40">
                <RefreshCw className="w-6 h-6 animate-spin text-orange-400" />
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  <KpiCard label="Necesitan atención" value={kpis?.needsAttention ?? 0} color="text-orange-400" icon={AlertTriangle} sub="presupuestos activos" />
                  <KpiCard label="No vistos" value={kpis?.notViewed ?? 0} color="text-slate-400" icon={EyeOff} />
                  <KpiCard label="Vistos sin pagar" value={kpis?.viewed ?? 0} color="text-sky-400" icon={Eye} />
                  <KpiCard label="Pausados" value={kpis?.paused ?? 0} color="text-amber-400" icon={Pause} />
                  <KpiCard label="Enviados hoy" value={kpis?.sentToday ?? 0} color="text-purple-400" icon={Send} sub="recordatorios automáticos" />
                  <KpiCard label="Fríos (+7 días)" value={kpis?.cold ?? 0} color="text-zinc-400" icon={Clock} />
                  <KpiCard label="Convertidos" value={kpis?.converted ?? 0} color="text-emerald-400" icon={CheckCircle2} />
                  <KpiCard label="Perdidos" value={kpis?.lost ?? 0} color="text-red-400" icon={XCircle} />
                </div>

                {/* ─── KPIs WhatsApp + Vapi ──────────────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-500/15 shrink-0">
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-emerald-400">
                        {whatsappStats?.conversations?.newToday ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">WhatsApp hoy</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-sky-500/15 shrink-0">
                      <MessageCircle className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-sky-400">
                        {whatsappStats?.conversations?.unread ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">WhatsApp no leídas</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-violet-500/15 shrink-0">
                      <Bot className="w-4 h-4 text-violet-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-violet-400">
                        {vapiStats?.today ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">Vapi llamadas hoy</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-amber-500/15 shrink-0">
                      <Bot className="w-4 h-4 text-amber-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-amber-400">
                        {vapiStats?.unreviewed ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">Vapi sin revisar</div>
                    </div>
                  </div>
                </div>

                {/* ─── KPIs Email Comercial ──────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-3">
                  <a href="/admin/atencion-comercial/email" className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 flex items-center gap-3 hover:bg-sky-500/10 transition-colors">
                    <div className="p-2 rounded-lg bg-sky-500/15 shrink-0">
                      <Mail className="w-4 h-4 text-sky-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-sky-400">
                        {emailStats?.receivedToday ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">Emails de hoy</div>
                    </div>
                  </a>
                  <a href="/admin/atencion-comercial/email" className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 flex items-center gap-3 hover:bg-orange-500/10 transition-colors">
                    <div className="p-2 rounded-lg bg-orange-500/15 shrink-0">
                      <MailOpen className="w-4 h-4 text-orange-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-orange-400">
                        {emailStats?.unreadInbox ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">Emails no leídos</div>
                    </div>
                  </a>
                  <a href="/admin/atencion-comercial/email?folder=sent" className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 flex items-center gap-3 hover:bg-teal-500/10 transition-colors">
                    <div className="p-2 rounded-lg bg-teal-500/15 shrink-0">
                      <SendHorizonal className="w-4 h-4 text-teal-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-teal-400">
                        {emailStats?.sent ?? 0}
                      </div>
                      <div className="text-xs text-foreground/50">Emails enviados</div>
                    </div>
                  </a>
                </div>

                {/* ─── Control notificaciones WhatsApp ───────────────────────── */}
                <div className="rounded-xl border border-border/50 bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground/70">
                    <Bell className="w-4 h-4 text-sky-400" />
                    Notificaciones WhatsApp — ventana emergente
                  </h3>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                      <div
                        className={`w-9 h-5 rounded-full transition-colors relative ${popupDisabled ? "bg-foreground/20" : "bg-sky-500"}`}
                        onClick={() => setPopupDisabled(!popupDisabled)}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${popupDisabled ? "left-0.5" : "left-4"}`} />
                      </div>
                      <div>
                        <div className="text-sm flex items-center gap-1.5">
                          {popupDisabled
                            ? <><BellOff className="w-3.5 h-3.5 text-foreground/40" /> <span className="text-foreground/50">Ventana emergente desactivada</span></>
                            : <><Bell className="w-3.5 h-3.5 text-sky-400" /> <span>Ventana emergente activada</span></>
                          }
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <div
                        className={`w-9 h-5 rounded-full transition-colors relative ${soundDisabled ? "bg-foreground/20" : "bg-emerald-500"}`}
                        onClick={() => setSoundDisabled(!soundDisabled)}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${soundDisabled ? "left-0.5" : "left-4"}`} />
                      </div>
                      <div>
                        <div className="text-sm flex items-center gap-1.5">
                          {soundDisabled
                            ? <><VolumeX className="w-3.5 h-3.5 text-foreground/40" /> <span className="text-foreground/50">Sonido desactivado</span></>
                            : <><Volume2 className="w-3.5 h-3.5 text-emerald-400" /> <span>Sonido activado</span></>
                          }
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Attention list */}
                <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
                  <div className="px-4 py-3 border-b border-foreground/[0.08] flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                      Presupuestos que requieren atención
                    </h2>
                    <button onClick={() => setTab("open")}
                      className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                      Ver todos <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-foreground/[0.08] text-foreground/40">
                          <th className="px-3 py-2 text-left font-medium">Presupuesto</th>
                          <th className="px-3 py-2 text-left font-medium">Cliente</th>
                          <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Enviado</th>
                          <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Importe</th>
                          <th className="px-3 py-2 text-left font-medium">Estado</th>
                          <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">Visto</th>
                          <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">Recs.</th>
                          <th className="px-3 py-2 text-right font-medium">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard?.attentionList ?? []).length === 0 && (
                          <tr><td colSpan={8} className="px-3 py-8 text-center text-foreground/30">Sin presupuestos pendientes</td></tr>
                        )}
                        {(dashboard?.attentionList ?? []).map(q => (
                          <QuoteActionRow key={q.id} quote={q} onAction={handleAction} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: OPEN QUOTES ────────────────────────────────────────────── */}
        {tab === "open" && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <Input placeholder="Buscar cliente, email, nº presupuesto..." value={openSearch}
                onChange={e => setOpenSearch(e.target.value)} className="h-8 text-xs w-64" />
              <Select value={openStatus} onValueChange={setOpenStatus}>
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder="Estado comercial" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los estados</SelectItem>
                  {Object.entries(COMMERCIAL_STATUS_CONFIG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={openViewed} onValueChange={v => setOpenViewed(v as any)}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="yes">Vistos</SelectItem>
                  <SelectItem value="no">No vistos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
              <div className="px-4 py-2.5 border-b border-foreground/[0.08] flex items-center justify-between">
                <span className="text-xs text-foreground/50">{openData?.total ?? 0} presupuestos</span>
              </div>
              {openLoading ? (
                <div className="flex items-center justify-center h-32"><RefreshCw className="w-5 h-5 animate-spin text-orange-400" /></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-foreground/[0.08] text-foreground/40">
                        <th className="px-3 py-2 text-left font-medium">Presupuesto</th>
                        <th className="px-3 py-2 text-left font-medium">Cliente</th>
                        <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Enviado</th>
                        <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Importe</th>
                        <th className="px-3 py-2 text-left font-medium">Estado</th>
                        <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">Visto</th>
                        <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">Recs.</th>
                        <th className="px-3 py-2 text-right font-medium">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(openData?.rows ?? []).length === 0 && (
                        <tr><td colSpan={8} className="px-3 py-8 text-center text-foreground/30">Sin resultados</td></tr>
                      )}
                      {(openData?.rows ?? []).map(q => (
                        <QuoteActionRow key={q.id} quote={q} onAction={handleAction} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: RULES ──────────────────────────────────────────────────── */}
        {tab === "rules" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => { setShowNewRule(true); resetRuleForm(); }}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs h-8">
                <Plus className="w-3.5 h-3.5 mr-1" /> Nueva regla
              </Button>
            </div>
            <div className="space-y-3">
              {(rules ?? []).map(rule => (
                <div key={rule.id} className={`rounded-xl border p-4 ${rule.isActive ? "border-foreground/[0.08] bg-background" : "border-foreground/[0.04] bg-foreground/[0.02] opacity-60"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${rule.isActive ? "bg-emerald-400" : "bg-zinc-500"}`} />
                        <span className="font-semibold text-sm text-foreground/80">{rule.name}</span>
                        <span className="text-[10px] text-foreground/40 bg-foreground/[0.06] px-1.5 py-0.5 rounded">
                          {rule.triggerFrom === "quote_sent_at" ? "desde envío" : "desde último recordatorio"} · {rule.delayHours}h
                        </span>
                      </div>
                      <div className="text-xs text-foreground/50 mb-2">
                        Asunto: <span className="text-foreground/70 font-medium">{rule.emailSubject}</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[10px] text-foreground/40">
                        {rule.onlyIfNotViewed && <span className="bg-foreground/[0.06] px-1.5 py-0.5 rounded">Solo no vistos</span>}
                        {rule.allowIfViewedButUnpaid && <span className="bg-foreground/[0.06] px-1.5 py-0.5 rounded">Vistos sin pagar: sí</span>}
                        <span className="bg-foreground/[0.06] px-1.5 py-0.5 rounded">Máx. {rule.maxSendsPerQuoteForThisRule}x por presupuesto</span>
                        <span className="bg-foreground/[0.06] px-1.5 py-0.5 rounded">Orden: {rule.sortOrder}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => updateRule.mutate({ id: rule.id, isActive: !rule.isActive })}
                        className={`p-1.5 rounded-lg hover:bg-foreground/[0.08] transition-colors ${rule.isActive ? "text-emerald-400" : "text-zinc-500"}`}
                        title={rule.isActive ? "Desactivar" : "Activar"}>
                        {rule.isActive ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => openEditRule(rule)}
                        className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-sky-400 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { if (confirm("¿Eliminar esta regla?")) deleteRule.mutate({ id: rule.id }); }}
                        className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!rules?.length && (
                <div className="text-center py-12 text-foreground/30 text-sm">
                  Sin reglas configuradas. Crea la primera regla.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: HISTORY ────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
            <div className="px-4 py-2.5 border-b border-foreground/[0.08]">
              <span className="text-xs text-foreground/50">{historyData?.total ?? 0} comunicaciones</span>
            </div>
            {histLoading ? (
              <div className="flex items-center justify-center h-32"><RefreshCw className="w-5 h-5 animate-spin text-orange-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-foreground/[0.08] text-foreground/40">
                      <th className="px-3 py-2 text-left font-medium">Fecha</th>
                      <th className="px-3 py-2 text-left font-medium">Presupuesto</th>
                      <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Cliente</th>
                      <th className="px-3 py-2 text-left font-medium">Tipo</th>
                      <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">Asunto</th>
                      <th className="px-3 py-2 text-left font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyData?.rows ?? []).length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-foreground/30">Sin historial</td></tr>
                    )}
                    {(historyData?.rows ?? []).map(c => (
                      <tr key={c.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.02]">
                        <td className="px-3 py-2.5 text-foreground/50">{fmtDateTime(c.sentAt)}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-orange-400 font-bold">{c.quoteNumber ?? `#${c.quoteId}`}</span>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-foreground/70">{c.clientName ?? c.customerEmail ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                            c.type === "automatic_reminder" ? "text-purple-300 bg-purple-500/15 border-purple-500/30" :
                            c.type === "manual_reminder" ? "text-sky-300 bg-sky-500/15 border-sky-500/30" :
                            c.type === "internal_note" ? "text-amber-300 bg-amber-500/15 border-amber-500/30" :
                            c.type === "lost_reason" ? "text-red-300 bg-red-500/15 border-red-500/30" :
                            "text-foreground/50 bg-foreground/[0.05] border-foreground/[0.12]"
                          }`}>
                            {c.type === "automatic_reminder" ? "Auto" :
                             c.type === "manual_reminder" ? "Manual" :
                             c.type === "internal_note" ? "Nota" :
                             c.type === "lost_reason" ? "Perdido" :
                             c.type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell text-foreground/60 truncate max-w-[200px]">{c.subject ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                            c.status === "sent" ? "text-emerald-300 bg-emerald-500/15" :
                            c.status === "failed" ? "text-red-300 bg-red-500/15" :
                            "text-zinc-300 bg-zinc-500/15"
                          }`}>
                            {c.status === "sent" ? "Enviado" : c.status === "failed" ? "Fallido" : "Omitido"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: SETTINGS ───────────────────────────────────────────────── */}
        {tab === "settings" && settings && (
          <div className="max-w-xl space-y-6">
            <div className="rounded-xl border border-foreground/[0.08] bg-background p-5 space-y-4">
              <h3 className="text-sm font-semibold text-foreground/80">Configuración global</h3>

              <div className="flex items-center justify-between">
                <Label className="text-xs text-foreground/70">Sistema de recordatorios activado</Label>
                <button onClick={() => setSEnabled(v => !v)}
                  className={`w-10 h-5 rounded-full transition-colors ${sEnabled ?? settings.enabled ? "bg-emerald-500" : "bg-foreground/20"}`}>
                  <span className={`block w-4 h-4 bg-white rounded-full shadow transition-transform mx-0.5 ${sEnabled ?? settings.enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-foreground/60">Máx. recordatorios por presupuesto</Label>
                  <Input type="number" min={1} max={20} value={sMax ?? settings.maxTotalRemindersPerQuote}
                    onChange={e => setSMax(Number(e.target.value))} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-foreground/60">Días máximos de seguimiento</Label>
                  <Input type="number" min={1} max={365} value={sDays ?? settings.stopAfterDays}
                    onChange={e => setSDays(Number(e.target.value))} className="h-8 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-foreground/60">Hora inicio envío (HH:MM)</Label>
                  <Input value={sStart ?? settings.allowedSendStart}
                    onChange={e => setSStart(e.target.value)} className="h-8 text-xs font-mono" placeholder="09:00" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-foreground/60">Hora fin envío (HH:MM)</Label>
                  <Input value={sEnd ?? settings.allowedSendEnd}
                    onChange={e => setSEnd(e.target.value)} className="h-8 text-xs font-mono" placeholder="21:00" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs text-foreground/60">CC interno (email)</Label>
                  <Input type="email" value={sCc ?? settings.internalCcEmail ?? ""}
                    onChange={e => setSCc(e.target.value)} className="h-8 text-xs" placeholder="reservas@nayadeexperiences.es" />
                </div>
              </div>

              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white text-xs"
                disabled={updateSettings.isPending}
                onClick={() => updateSettings.mutate({
                  enabled: sEnabled ?? settings.enabled,
                  maxTotalRemindersPerQuote: sMax ?? settings.maxTotalRemindersPerQuote,
                  allowedSendStart: sStart ?? settings.allowedSendStart,
                  allowedSendEnd: sEnd ?? settings.allowedSendEnd,
                  stopAfterDays: sDays ?? settings.stopAfterDays,
                  internalCcEmail: sCc || undefined,
                })}>
                {updateSettings.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
                Guardar configuración
              </Button>

              <div className="pt-2 border-t border-foreground/[0.08] space-y-1">
                <p className="text-[10px] text-foreground/40">
                  <strong className="text-foreground/60">Feature flag:</strong> <code>commercial_followup_job_enabled</code> — activa/desactiva el cron desde el panel de configuración del sistema.
                </p>
                <p className="text-[10px] text-foreground/40">
                  Zona horaria: <strong className="text-foreground/60">Europe/Madrid</strong>. El cron corre cada hora en punto.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal: Recordatorio manual ─────────────────────────────────────── */}
      <Dialog open={!!remindQuote} onOpenChange={() => setRemindQuote(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Enviar recordatorio manual</DialogTitle>
          </DialogHeader>
          {remindQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-orange-400">{remindQuote.quoteNumber}</span> · {remindQuote.clientName} · {remindQuote.clientEmail}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Asunto (opcional)</Label>
                <Input value={remindSubject} onChange={e => setRemindSubject(e.target.value)} className="text-xs h-8"
                  placeholder="Se usará la plantilla automática si está vacío" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cuerpo personalizado (opcional)</Label>
                <Textarea value={remindBody} onChange={e => setRemindBody(e.target.value)} rows={4} className="text-xs"
                  placeholder="Si lo dejas vacío se usará la plantilla según el número de recordatorio" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemindQuote(null)}>Cancelar</Button>
            <Button size="sm" className="bg-purple-600 hover:bg-purple-700 text-white"
              disabled={sendManualReminder.isPending}
              onClick={() => sendManualReminder.mutate({
                quoteId: remindQuote.id,
                customSubject: remindSubject || undefined,
                customBody: remindBody || undefined,
              })}>
              {sendManualReminder.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Añadir nota ─────────────────────────────────────────────── */}
      <Dialog open={!!noteQuote} onOpenChange={() => setNoteQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Añadir nota comercial</DialogTitle>
          </DialogHeader>
          {noteQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-orange-400">{noteQuote.quoteNumber}</span> · {noteQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Canal</Label>
                <Select value={noteChannel} onValueChange={v => setNoteChannel(v as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Nota interna</SelectItem>
                    <SelectItem value="phone">Llamada telefónica</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nota</Label>
                <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} className="text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNoteQuote(null)}>Cancelar</Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={addNote.isPending || !noteText.trim()}
              onClick={() => addNote.mutate({ quoteId: noteQuote.id, note: noteText, channel: noteChannel })}>
              Guardar nota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Marcar como perdido ────────────────────────────────────── */}
      <Dialog open={!!lostQuote} onOpenChange={() => setLostQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400">Marcar como perdido</DialogTitle>
          </DialogHeader>
          {lostQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-orange-400">{lostQuote.quoteNumber}</span> · {lostQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Motivo (opcional)</Label>
                <Textarea value={lostReason} onChange={e => setLostReason(e.target.value)} rows={2} className="text-xs"
                  placeholder="Precio, competencia, cambio de planes..." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLostQuote(null)}>Cancelar</Button>
            <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white"
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ quoteId: lostQuote.id, status: "lost", lostReason })}>
              Marcar como perdido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Pausar recordatorios ───────────────────────────────────── */}
      <Dialog open={!!pauseQuote} onOpenChange={() => setPauseQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pausar recordatorios</DialogTitle>
          </DialogHeader>
          {pauseQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-orange-400">{pauseQuote.quoteNumber}</span> · {pauseQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Motivo de pausa (opcional)</Label>
                <Input value={pauseReason} onChange={e => setPauseReason(e.target.value)} className="text-xs h-8"
                  placeholder="Cliente pidió más tiempo..." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPauseQuote(null)}>Cancelar</Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={pauseReminders.isPending}
              onClick={() => pauseReminders.mutate({ quoteId: pauseQuote.id, reason: pauseReason || undefined })}>
              <Pause className="w-3.5 h-3.5 mr-1" /> Pausar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Crear / Editar regla ───────────────────────────────────── */}
      <Dialog open={showNewRule || !!editRule} onOpenChange={() => { setShowNewRule(false); setEditRule(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editRule ? "Editar regla" : "Nueva regla de recordatorio"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Nombre de la regla</Label>
              <Input value={ruleForm.name} onChange={e => setRuleForm(f => ({ ...f, name: e.target.value }))} className="text-xs h-8" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">Horas de retraso</Label>
                <Input type="number" min={1} value={ruleForm.delayHours}
                  onChange={e => setRuleForm(f => ({ ...f, delayHours: Number(e.target.value) }))} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Disparar desde</Label>
                <Select value={ruleForm.triggerFrom} onValueChange={v => setRuleForm(f => ({ ...f, triggerFrom: v as any }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="quote_sent_at">Envío del presupuesto</SelectItem>
                    <SelectItem value="last_reminder_at">Último recordatorio</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Máx. envíos por presupuesto para esta regla</Label>
                <Input type="number" min={1} max={10} value={ruleForm.maxSendsPerQuoteForThisRule}
                  onChange={e => setRuleForm(f => ({ ...f, maxSendsPerQuoteForThisRule: Number(e.target.value) }))} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Orden de ejecución</Label>
                <Input type="number" min={0} value={ruleForm.sortOrder}
                  onChange={e => setRuleForm(f => ({ ...f, sortOrder: Number(e.target.value) }))} className="text-xs h-8" />
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs text-foreground/70 cursor-pointer">
                <input type="checkbox" checked={ruleForm.onlyIfNotViewed}
                  onChange={e => setRuleForm(f => ({ ...f, onlyIfNotViewed: e.target.checked }))} />
                Solo si no ha sido visto
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground/70 cursor-pointer">
                <input type="checkbox" checked={ruleForm.allowIfViewedButUnpaid}
                  onChange={e => setRuleForm(f => ({ ...f, allowIfViewedButUnpaid: e.target.checked }))} />
                Enviar aunque esté visto (si no pagado)
              </label>
              <label className="flex items-center gap-2 text-xs text-foreground/70 cursor-pointer">
                <input type="checkbox" checked={ruleForm.isActive}
                  onChange={e => setRuleForm(f => ({ ...f, isActive: e.target.checked }))} />
                Activa
              </label>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Asunto del email</Label>
              <Input value={ruleForm.emailSubject}
                onChange={e => setRuleForm(f => ({ ...f, emailSubject: e.target.value }))} className="text-xs h-8"
                placeholder="Usa {{clientName}} y {{quoteNumber}}" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cuerpo del email</Label>
              <Textarea value={ruleForm.emailBody}
                onChange={e => setRuleForm(f => ({ ...f, emailBody: e.target.value }))} rows={5} className="text-xs"
                placeholder="Usa {{clientName}} y {{quoteNumber}}" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowNewRule(false); setEditRule(null); }}>Cancelar</Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white"
              disabled={createRule.isPending || updateRule.isPending || !ruleForm.name || !ruleForm.emailSubject || !ruleForm.emailBody}
              onClick={() => {
                if (editRule) {
                  updateRule.mutate({ id: editRule.id, ...ruleForm });
                } else {
                  createRule.mutate(ruleForm);
                }
              }}>
              {editRule ? "Guardar cambios" : "Crear regla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
