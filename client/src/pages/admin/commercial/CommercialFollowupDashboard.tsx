import React, { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
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
  History, ChevronRight, RefreshCw, TrendingUp,
  Users, Clock, AlertTriangle, Ban, Target, ArrowRight,
  Bot, Bell, BellOff, Volume2, VolumeX, Mail, MailOpen, SendHorizonal,
  Map, Zap, ClipboardCheck,
} from "lucide-react";
import { NOTIF_POPUP_KEY, NOTIF_SOUND_KEY } from "@/components/WhatsAppNotification";
import CommunicationsMap from "./CommunicationsMap";
import LegacyAutomationsTab from "./LegacyAutomationsTab";
import EmailAuditTab from "./EmailAuditTab";
import TemplateRulesTab from "./TemplateRulesTab";
import PendingJobsTab from "./PendingJobsTab";
import { toastError } from "@/lib/errorMessage";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelPageHeader, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "open" | "history" | "mapa" | "automatizaciones" | "auditoria" | "plantillas" | "cola";

const COMMERCIAL_STATUS_CONFIG: Record<string, { color: string; bg: string; border: string }> = {
  pending_followup: { color: "text-foreground/70",   bg: "bg-muted/15",   border: "border-border" },
  reminder_1_sent:  { color: "text-primary",  bg: "bg-primary/15",  border: "border-primary/30" },
  reminder_2_sent:  { color: "text-primary",  bg: "bg-primary/15",  border: "border-primary/30" },
  reminder_3_sent:  { color: "text-info",  bg: "bg-info/15",  border: "border-info/30" },
  interested:       { color: "text-success", bg: "bg-success/15", border: "border-success/30" },
  paused:           { color: "text-warning",   bg: "bg-warning/15",   border: "border-warning/30" },
  lost:             { color: "text-danger",     bg: "bg-danger/15",     border: "border-danger/30" },
  converted:        { color: "text-success",   bg: "bg-success/15",   border: "border-success/30" },
  discarded:        { color: "text-muted-foreground",    bg: "bg-muted/15",    border: "border-border" },
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const cfg = COMMERCIAL_STATUS_CONFIG[status ?? "pending_followup"] ?? COMMERCIAL_STATUS_CONFIG.pending_followup;
  return (
    <span className={`inline-flex items-center text-xs font-bold px-1.5 py-0.5 rounded-full border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {t(`crmFollowup.status.${COMMERCIAL_STATUS_CONFIG[status ?? "pending_followup"] ? (status ?? "pending_followup") : "pending_followup"}`)}
    </span>
  );
}

type Fmt = ReturnType<typeof useI18n>["format"];

function fmtDate(format: Fmt, d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format.date(d, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtDateTime(format: Fmt, d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format.dateTime(d, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function daysSince(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

/** Tono semántico del indicador a partir del color que le asigna cada llamada. */
function kpiTone(color: string): Tone {
  if (color.includes("emerald")) return "success";
  if (color.includes("red")) return "danger";
  if (color.includes("orange") || color.includes("amber")) return "warning";
  if (color.includes("sky")) return "info";
  if (color.includes("purple")) return "brand";
  return "neutral";
}

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: number | string; sub?: string; color: string; icon: React.ElementType;
}) {
  return (
    <MetricCard tone={kpiTone(color)} icon={<Icon />} label={label} value={value} detail={sub} />
  );
}

// ─── Action Row ───────────────────────────────────────────────────────────────

function QuoteActionRow({ quote, onAction }: {
  quote: any;
  onAction: (action: string, quote: any) => void;
}) {
  const { t, format } = useI18n();
  const days = daysSince(quote.sentAt);
  const cfg = COMMERCIAL_STATUS_CONFIG[quote.commercialStatus ?? "pending_followup"] ?? COMMERCIAL_STATUS_CONFIG.pending_followup;
  return (
    <tr className="border-b border-foreground/[0.05] hover:bg-foreground/[0.02] transition-colors">
      <td className="px-3 py-2.5">
        <div className="font-mono text-xs text-warning font-bold">{quote.quoteNumber}</div>
        {quote.title && <div className="text-xs text-foreground/40 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{quote.title}</div>}
      </td>
      <td className="px-3 py-2.5">
        <div className="text-xs font-medium text-foreground/80 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{quote.clientName ?? "—"}</div>
        <div className="text-xs text-foreground/40 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{quote.clientEmail ?? ""}</div>
      </td>
      <td className="px-3 py-2.5 hidden md:table-cell">
        <div className="text-xs text-foreground/60">{fmtDate(format, quote.sentAt)}</div>
        {days !== null && <div className="text-xs text-foreground/35">{t("crmFollowup.daysAgo", { days })}</div>}
      </td>
      <td className="px-3 py-2.5 hidden lg:table-cell">
        <span className="text-xs font-bold text-warning">{format.currency(Number(quote.total ?? 0))}</span>
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={quote.commercialStatus} />
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        {quote.viewedAt
          ? <span className="inline-flex items-center gap-1 text-xs text-info"><Eye className="w-3 h-3" /> {fmtDate(format, quote.viewedAt)}</span>
          : <span className="inline-flex items-center gap-1 text-xs text-foreground/30"><EyeOff className="w-3 h-3" /> {t("crmFollowup.notSeen")}</span>
        }
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        <span className="text-xs text-foreground/50">{quote.trackingReminderCount ?? quote.reminderCount ?? 0}</span>
      </td>
      <td className="px-3 py-2.5 hidden xl:table-cell">
        {quote.nextScheduledAt ? (
          <div>
            <div className="text-xs text-foreground/70">{fmtDateTime(format, quote.nextScheduledAt)}</div>
            {quote.nextScheduledRule && (
              <div className="text-xs text-foreground/40 overflow-hidden text-ellipsis whitespace-nowrap max-w-[120px]">{quote.nextScheduledRule}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-foreground/30">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-0.5 justify-end">
          {quote.paymentLinkUrl && (
            <a href={quote.paymentLinkUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-info transition-colors" title={t("crmFollowup.viewQuote")}>
              <Eye className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={() => onAction("remind", quote)} title={t("crmFollowup.sendReminder")}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-primary transition-colors">
            <Send className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onAction("note", quote)} title={t("crmFollowup.addNote")}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-warning transition-colors">
            <StickyNote className="w-3.5 h-3.5" />
          </button>
          {quote.reminderPaused
            ? <button onClick={() => onAction("resume", quote)} title={t("crmFollowup.resume")}
                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-warning hover:text-success transition-colors">
                <Play className="w-3.5 h-3.5" />
              </button>
            : <button onClick={() => onAction("pause", quote)} title={t("crmFollowup.pause")}
                className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-warning transition-colors">
                <Pause className="w-3.5 h-3.5" />
              </button>
          }
          <button onClick={() => onAction("interested", quote)} title={t("crmFollowup.markInterested")}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-success transition-colors">
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onAction("lost", quote)} title={t("crmFollowup.markLost")}
            className="p-1.5 rounded-lg hover:bg-foreground/[0.08] text-foreground/40 hover:text-danger transition-colors">
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CommercialFollowupDashboard() {
  const { t, format } = useI18n();
  const searchStr = useSearch();
  const tabFromUrl = (): Tab => {
    try {
      const t = new URLSearchParams(searchStr).get("tab");
      // Redirige tab=rules (eliminada en Fase 4) a plantillas, donde viven las reglas ahora
      if (t === "rules") return "plantillas";
      if (t === "settings") return "plantillas"; // pestaña eliminada en Fase 5
      if (t === "dashboard" || t === "open" || t === "history" ||
          t === "mapa" || t === "plantillas" || t === "cola" ||
          t === "automatizaciones" || t === "auditoria") return t as Tab;
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

  // ─── Notif settings (localStorage) ───────────────────────────────────────
  const [popupDisabled, setPopupDisabledState] = useState(() => localStorage.getItem(NOTIF_POPUP_KEY) === "true");
  const [soundDisabled, setSoundDisabledState] = useState(() => localStorage.getItem(NOTIF_SOUND_KEY) === "true");

  const setPopupDisabled = (v: boolean) => { localStorage.setItem(NOTIF_POPUP_KEY, String(v)); setPopupDisabledState(v); };
  const setSoundDisabled = (v: boolean) => { localStorage.setItem(NOTIF_SOUND_KEY, String(v)); setSoundDisabledState(v); };

  // ─── Queries ──────────────────────────────────────────────────────────────
  // WhatsApp y llamadas solo con su módulo contratado (si no, el servidor deniega la consulta)
  const panelSub = usePanelSubscription();
  const hasWhatsApp = panelSub.can("whatsapp-ai");
  const hasVoice = panelSub.can("voice-ai");

  const { data: dashboard, isLoading: dashLoading, error: dashError, refetch: refetchDash } =
    trpc.commercialFollowup.getDashboard.useQuery(undefined, { enabled: tab === "dashboard" });

  const { data: whatsappStats } = trpc.ghlInbox.getStats.useQuery(undefined, {
    enabled: tab === "dashboard" && hasWhatsApp, refetchInterval: 15000,
  });

  const { data: vapiStats } = trpc.vapiCalls.getStats.useQuery(undefined, {
    enabled: tab === "dashboard" && hasVoice, refetchInterval: 15000,
  });

  const { data: emailStats } = trpc.emailInbox.getStats.useQuery({}, {
    enabled: tab === "dashboard", refetchInterval: 30000,
  });

  const { data: openData, isLoading: openLoading, refetch: refetchOpen } =
    trpc.commercialFollowup.listOpen.useQuery(
      { search: openSearch || undefined, commercialStatus: openStatus === "all" ? undefined : openStatus || undefined, viewed: openViewed, limit: 100, offset: 0 },
      { enabled: tab === "open" }
    );

  const { data: historyData, isLoading: histLoading } =
    trpc.commercialFollowup.listCommunications.useQuery({ limit: 200, offset: 0 }, { enabled: tab === "history" });

  // ─── Mutations ────────────────────────────────────────────────────────────

  const sendManualReminder = trpc.commercialFollowup.sendManualReminder.useMutation({
    onSuccess: () => { toast.success(t("crmFollowup.reminderSent")); setRemindQuote(null); refetchDash(); refetchOpen(); },
    onError: (e) => toastError(e),
  });

  const addNote = trpc.commercialFollowup.addNote.useMutation({
    onSuccess: () => { toast.success(t("crmFollowup.noteSaved")); setNoteQuote(null); setNoteText(""); },
    onError: (e) => toastError(e),
  });

  const updateStatus = trpc.commercialFollowup.updateCommercialStatus.useMutation({
    onSuccess: () => { toast.success(t("crmFollowup.statusUpdated")); setLostQuote(null); setLostReason(""); refetchDash(); refetchOpen(); },
    onError: (e) => toastError(e),
  });

  const pauseReminders = trpc.commercialFollowup.pauseReminders.useMutation({
    onSuccess: () => { toast.success(t("crmFollowup.remindersPaused")); setPauseQuote(null); setPauseReason(""); refetchDash(); refetchOpen(); },
    onError: (e) => toastError(e),
  });

  const resumeReminders = trpc.commercialFollowup.resumeReminders.useMutation({
    onSuccess: () => { toast.success(t("crmFollowup.remindersResumed")); refetchDash(); refetchOpen(); },
    onError: (e) => toastError(e),
  });

  // CRUD de reglas y settings eliminado en Fases 4-5. Toda la configuración
  // de recordatorios vive en email_automation_rules y se gestiona desde la
  // pestaña "Plantillas".

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleAction(action: string, quote: any) {
    if (action === "remind") { setRemindQuote(quote); setRemindSubject(""); setRemindBody(""); }
    if (action === "note") { setNoteQuote(quote); setNoteText(""); }
    if (action === "lost") { setLostQuote(quote); setLostReason(""); }
    if (action === "pause") { setPauseQuote(quote); setPauseReason(""); }
    if (action === "resume") resumeReminders.mutate({ quoteId: quote.id });
    if (action === "interested") updateStatus.mutate({ quoteId: quote.id, status: "interested" });
  }

  // ─── Tab Navigation ───────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "dashboard", label: t("crmFollowup.tab.dashboard"), icon: BarChart3 },
    { id: "open", label: t("crmFollowup.tab.open"), icon: List },
    { id: "history", label: t("crmFollowup.tab.history"), icon: History },
    { id: "mapa", label: t("crmFollowup.tab.mapa"), icon: Map },
    { id: "plantillas", label: t("crmFollowup.tab.plantillas"), icon: Settings },
    { id: "cola", label: t("crmFollowup.tab.cola"), icon: Bell },
    { id: "automatizaciones", label: t("crmFollowup.tab.automatizaciones"), icon: Zap },
    { id: "auditoria", label: t("crmFollowup.tab.auditoria"), icon: ClipboardCheck },
  ];

  const kpis = dashboard?.kpis;

  // Pestaña "Configuración" + sus settings locales eliminados en Fase 5.

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <PanelPageHeader
          icon={<Target />}
          title={t("crmFollowup.title")}
          description={t("crmFollowup.subtitle")}
          actions={
            <Button type="button" variant="outline" size="icon" aria-label={t("panelStates.retry")} onClick={() => { refetchDash(); refetchOpen(); }}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </Button>
          }
        />
        <WorkplaceLocks place="crm" className="mb-6" />

        {/* Tab nav */}
        <div className="flex gap-1 mb-6 border-b border-border pb-0 overflow-x-auto">
          {tabs.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px ${
                tab === tb.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}>
              <tb.icon className="w-3.5 h-3.5" />
              {tb.label}
            </button>
          ))}
        </div>

        {/* ── TAB: DASHBOARD ──────────────────────────────────────────────── */}
        {tab === "dashboard" && (
          <div className="space-y-6">
            {dashError ? (
              <PanelError title={t("crmFollowup.loadError")} error={dashError} onRetry={() => void refetchDash()} />
            ) : dashLoading ? (
              <PanelLoading />
            ) : (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <KpiCard label={t("crmFollowup.kpi.needsAttention")} value={kpis?.needsAttention ?? 0} color="text-warning" icon={AlertTriangle} sub={t("crmFollowup.kpi.activeQuotes")} />
                  <KpiCard label={t("crmFollowup.kpi.notViewed")} value={kpis?.notViewed ?? 0} color="text-muted-foreground" icon={EyeOff} />
                  <KpiCard label={t("crmFollowup.kpi.viewedUnpaid")} value={kpis?.viewed ?? 0} color="text-info" icon={Eye} />
                  <KpiCard label={t("crmFollowup.kpi.paused")} value={kpis?.paused ?? 0} color="text-warning" icon={Pause} />
                  <KpiCard label={t("crmFollowup.kpi.sentToday")} value={kpis?.sentToday ?? 0} color="text-primary" icon={Send} sub={t("crmFollowup.kpi.autoReminders")} />
                  <KpiCard label={t("crmFollowup.kpi.cold")} value={kpis?.cold ?? 0} color="text-muted-foreground" icon={Clock} />
                  <KpiCard label={t("crmFollowup.kpi.converted")} value={kpis?.converted ?? 0} color="text-success" icon={CheckCircle2} />
                  <KpiCard label={t("crmFollowup.kpi.lost")} value={kpis?.lost ?? 0} color="text-danger" icon={XCircle} />
                </div>

                {/* ─── KPIs WhatsApp + llamadas (solo con su módulo contratado) ─ */}
                {(hasWhatsApp || hasVoice) && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {hasWhatsApp && (<>
                  <MetricCard tone="success" icon={<MessageCircle />} label={t("crmFollowup.kpi.whatsappToday")} value={whatsappStats?.conversations?.newToday ?? 0} />
                  <MetricCard tone="info" icon={<MessageCircle />} label={t("crmFollowup.kpi.whatsappUnread")} value={whatsappStats?.conversations?.unread ?? 0} />
                  </>)}
                  {hasVoice && (<>
                  <MetricCard tone="brand" icon={<Bot />} label={t("crmFollowup.kpi.callsToday")} value={vapiStats?.today ?? 0} />
                  <MetricCard tone="warning" icon={<Bot />} label={t("crmFollowup.kpi.callsUnreviewed")} value={vapiStats?.unreviewed ?? 0} />
                  </>)}
                </div>
                )}

                {/* ─── KPIs Email Comercial ──────────────────────────────────── */}
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard tone="info" icon={<Mail />} label={t("crmFollowup.kpi.emailsToday")} value={emailStats?.receivedToday ?? 0} href="/admin/atencion-comercial/email" />
                  <MetricCard tone="warning" icon={<MailOpen />} label={t("crmFollowup.kpi.emailsUnread")} value={emailStats?.unreadInbox ?? 0} href="/admin/atencion-comercial/email" />
                  <MetricCard tone="info" icon={<SendHorizonal />} label={t("crmFollowup.kpi.emailsSent")} value={emailStats?.sent ?? 0} href="/admin/atencion-comercial/email?folder=sent" />
                </div>

                {/* ─── Control notificaciones WhatsApp ───────────────────────── */}
                {hasWhatsApp && (
                <div className="rounded-xl border border-border/50 bg-card p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-foreground/70">
                    <Bell className="w-4 h-4 text-info" />
                    {t("crmFollowup.notif.title")}
                  </h3>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none group">
                      <div
                        className={`w-9 h-5 rounded-full transition-colors relative ${popupDisabled ? "bg-foreground/20" : "bg-info"}`}
                        onClick={() => setPopupDisabled(!popupDisabled)}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${popupDisabled ? "left-0.5" : "left-4"}`} />
                      </div>
                      <div>
                        <div className="text-sm flex items-center gap-1.5">
                          {popupDisabled
                            ? <><BellOff className="w-3.5 h-3.5 text-foreground/40" /> <span className="text-foreground/50">{t("crmFollowup.notif.popupOff")}</span></>
                            : <><Bell className="w-3.5 h-3.5 text-info" /> <span>{t("crmFollowup.notif.popupOn")}</span></>
                          }
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <div
                        className={`w-9 h-5 rounded-full transition-colors relative ${soundDisabled ? "bg-foreground/20" : "bg-success"}`}
                        onClick={() => setSoundDisabled(!soundDisabled)}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${soundDisabled ? "left-0.5" : "left-4"}`} />
                      </div>
                      <div>
                        <div className="text-sm flex items-center gap-1.5">
                          {soundDisabled
                            ? <><VolumeX className="w-3.5 h-3.5 text-foreground/40" /> <span className="text-foreground/50">{t("crmFollowup.notif.soundOff")}</span></>
                            : <><Volume2 className="w-3.5 h-3.5 text-success" /> <span>{t("crmFollowup.notif.soundOn")}</span></>
                          }
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
                )}

                {/* Attention list */}
                <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
                  <div className="px-4 py-3 border-b border-foreground/[0.08] flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-foreground/80 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-warning" />
                      {t("crmFollowup.attention.title")}
                    </h2>
                    <button onClick={() => setTab("open")}
                      className="text-xs text-warning hover:text-warning flex items-center gap-1">
                      {t("crmFollowup.attention.seeAll")} <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-foreground/[0.08] text-foreground/40">
                          <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.quote")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.client")}</th>
                          <th className="px-3 py-2 text-left font-medium hidden md:table-cell">{t("crmFollowup.col.sent")}</th>
                          <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">{t("crmFollowup.col.amount")}</th>
                          <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.status")}</th>
                          <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">{t("crmFollowup.col.seen")}</th>
                          <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">{t("crmFollowup.col.recs")}</th>
                          <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">{t("crmFollowup.col.nextSend")}</th>
                          <th className="px-3 py-2 text-right font-medium">{t("crmFollowup.col.actions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard?.attentionList ?? []).length === 0 && (
                          <tr><td colSpan={9} className="px-3 py-8 text-center text-foreground/30">{t("crmFollowup.attention.empty")}</td></tr>
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
              <Input placeholder={t("crmFollowup.open.search")} value={openSearch}
                onChange={e => setOpenSearch(e.target.value)} className="h-8 text-xs w-64" />
              <Select value={openStatus} onValueChange={setOpenStatus}>
                <SelectTrigger className="h-8 text-xs w-44">
                  <SelectValue placeholder={t("crmFollowup.open.statusPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("crmFollowup.open.allStatuses")}</SelectItem>
                  {Object.keys(COMMERCIAL_STATUS_CONFIG).map((k) => (
                    <SelectItem key={k} value={k}>{t(`crmFollowup.status.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={openViewed} onValueChange={v => setOpenViewed(v as any)}>
                <SelectTrigger className="h-8 text-xs w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("crmFollowup.open.all")}</SelectItem>
                  <SelectItem value="yes">{t("crmFollowup.open.viewed")}</SelectItem>
                  <SelectItem value="no">{t("crmFollowup.open.notViewed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
              <div className="px-4 py-2.5 border-b border-foreground/[0.08] flex items-center justify-between">
                <span className="text-xs text-foreground/50">{t("crmFollowup.open.count", { n: openData?.total ?? 0 })}</span>
              </div>
              {openLoading ? (
                <PanelLoading />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-foreground/[0.08] text-foreground/40">
                        <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.quote")}</th>
                        <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.client")}</th>
                        <th className="px-3 py-2 text-left font-medium hidden md:table-cell">{t("crmFollowup.col.sent")}</th>
                        <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">{t("crmFollowup.col.amount")}</th>
                        <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.status")}</th>
                        <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">{t("crmFollowup.col.seen")}</th>
                        <th className="px-3 py-2 text-left font-medium hidden xl:table-cell">{t("crmFollowup.col.recs")}</th>
                        <th className="px-3 py-2 text-right font-medium">{t("crmFollowup.col.actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(openData?.rows ?? []).length === 0 && (
                        <tr><td colSpan={9} className="px-3 py-8 text-center text-foreground/30">{t("crmFollowup.open.empty")}</td></tr>
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
        {/* Pestaña "Reglas" (commercial_followup_rules) eliminada en Fase 4.
            Las reglas ahora viven en email_automation_rules y se gestionan
            desde la pestaña "Plantillas". */}

        {/* ── TAB: HISTORY ────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="rounded-xl border border-foreground/[0.08] bg-background overflow-hidden">
            <div className="px-4 py-2.5 border-b border-foreground/[0.08]">
              <span className="text-xs text-foreground/50">{t("crmFollowup.history.count", { n: historyData?.total ?? 0 })}</span>
            </div>
            {histLoading ? (
              <PanelLoading />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-foreground/[0.08] text-foreground/40">
                      <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.date")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.quote")}</th>
                      <th className="px-3 py-2 text-left font-medium hidden md:table-cell">{t("crmFollowup.col.client")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.type")}</th>
                      <th className="px-3 py-2 text-left font-medium hidden lg:table-cell">{t("crmFollowup.col.subject")}</th>
                      <th className="px-3 py-2 text-left font-medium">{t("crmFollowup.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyData?.rows ?? []).length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-foreground/30">{t("crmFollowup.history.empty")}</td></tr>
                    )}
                    {(historyData?.rows ?? []).map(c => (
                      <tr key={c.id} className="border-b border-foreground/[0.05] hover:bg-foreground/[0.02]">
                        <td className="px-3 py-2.5 text-foreground/50">{fmtDateTime(format, c.sentAt)}</td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-warning font-bold">{c.quoteNumber ?? `#${c.quoteId}`}</span>
                        </td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-foreground/70">{c.clientName ?? c.customerEmail ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full border ${
                            c.type === "automatic_reminder" ? "text-primary bg-primary/15 border-primary/30" :
                            c.type === "manual_reminder" ? "text-info bg-info/15 border-info/30" :
                            c.type === "internal_note" ? "text-warning bg-warning/15 border-warning/30" :
                            c.type === "lost_reason" ? "text-danger bg-danger/15 border-danger/30" :
                            "text-foreground/50 bg-foreground/[0.05] border-foreground/[0.12]"
                          }`}>
                            {c.type === "automatic_reminder" ? t("crmFollowup.history.typeAuto") :
                             c.type === "manual_reminder" ? t("crmFollowup.history.typeManual") :
                             c.type === "internal_note" ? t("crmFollowup.history.typeNote") :
                             c.type === "lost_reason" ? t("crmFollowup.history.typeLost") :
                             c.type}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell text-foreground/60 overflow-hidden text-ellipsis whitespace-nowrap max-w-[200px]">{c.subject ?? "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full ${
                            c.status === "sent" ? "text-success bg-success/15" :
                            c.status === "failed" ? "text-danger bg-danger/15" :
                            "text-foreground/70 bg-muted/15"
                          }`}>
                            {c.status === "sent" ? t("crmFollowup.history.sent") : c.status === "failed" ? t("crmFollowup.history.failed") : t("crmFollowup.history.skipped")}
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

        {/* ── TAB: MAPA DE EMAILS ─────────────────────────────────────────── */}
        {tab === "mapa" && <CommunicationsMap />}

        {/* ── TAB: PLANTILLAS Y REGLAS ─────────────────────────────────────── */}
        {tab === "plantillas" && <TemplateRulesTab />}

        {/* ── TAB: COLA DE ENVÍOS ──────────────────────────────────────────── */}
        {tab === "cola" && <PendingJobsTab />}

        {/* ── TAB: AUTOMATIZACIONES ────────────────────────────────────────── */}
        {tab === "automatizaciones" && <LegacyAutomationsTab />}

        {/* ── TAB: AUDITORÍA ───────────────────────────────────────────────── */}
        {tab === "auditoria" && <EmailAuditTab />}

        {/* Pestaña "Configuración" eliminada en Fase 5.
            La configuración global vivía en commercial_followup_settings; ahora
            cada regla en email_automation_rules tiene sus propios horarios,
            límites y stopAfterDays. Se gestiona desde la pestaña "Plantillas". */}
      </div>

      {/* ── Modal: Recordatorio manual ─────────────────────────────────────── */}
      <Dialog open={!!remindQuote} onOpenChange={() => setRemindQuote(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("crmFollowup.remind.title")}</DialogTitle>
          </DialogHeader>
          {remindQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-warning">{remindQuote.quoteNumber}</span> · {remindQuote.clientName} · {remindQuote.clientEmail}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.remind.subject")}</Label>
                <Input value={remindSubject} onChange={e => setRemindSubject(e.target.value)} className="text-xs h-8"
                  placeholder={t("crmFollowup.remind.subjectPlaceholder")} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.remind.body")}</Label>
                <Textarea value={remindBody} onChange={e => setRemindBody(e.target.value)} rows={4} className="text-xs"
                  placeholder={t("crmFollowup.remind.bodyPlaceholder")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRemindQuote(null)}>{t("crmFollowup.remind.cancel")}</Button>
            <Button size="sm" 
              disabled={sendManualReminder.isPending}
              onClick={() => sendManualReminder.mutate({
                quoteId: remindQuote.id,
                customSubject: remindSubject || undefined,
                customBody: remindBody || undefined,
              })}>
              {sendManualReminder.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              {t("crmFollowup.remind.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Añadir nota ─────────────────────────────────────────────── */}
      <Dialog open={!!noteQuote} onOpenChange={() => setNoteQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("crmFollowup.note.title")}</DialogTitle>
          </DialogHeader>
          {noteQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-warning">{noteQuote.quoteNumber}</span> · {noteQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.note.channel")}</Label>
                <Select value={noteChannel} onValueChange={v => setNoteChannel(v as any)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">{t("crmFollowup.note.internal")}</SelectItem>
                    <SelectItem value="phone">{t("crmFollowup.note.phone")}</SelectItem>
                    <SelectItem value="whatsapp">{t("crmFollowup.note.whatsapp")}</SelectItem>
                    <SelectItem value="email">{t("crmFollowup.note.email")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.note.note")}</Label>
                <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3} className="text-xs" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNoteQuote(null)}>{t("crmFollowup.note.cancel")}</Button>
            <Button size="sm" className="bg-warning hover:bg-warning text-background"
              disabled={addNote.isPending || !noteText.trim()}
              onClick={() => addNote.mutate({ quoteId: noteQuote.id, note: noteText, channel: noteChannel })}>
              {t("crmFollowup.note.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Marcar como perdido ────────────────────────────────────── */}
      <Dialog open={!!lostQuote} onOpenChange={() => setLostQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-danger">{t("crmFollowup.lost.title")}</DialogTitle>
          </DialogHeader>
          {lostQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-warning">{lostQuote.quoteNumber}</span> · {lostQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.lost.reason")}</Label>
                <Textarea value={lostReason} onChange={e => setLostReason(e.target.value)} rows={2} className="text-xs"
                  placeholder={t("crmFollowup.lost.placeholder")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLostQuote(null)}>{t("crmFollowup.lost.cancel")}</Button>
            <Button variant="destructive" size="sm" 
              disabled={updateStatus.isPending}
              onClick={() => updateStatus.mutate({ quoteId: lostQuote.id, status: "lost", lostReason })}>
              {t("crmFollowup.lost.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Pausar recordatorios ───────────────────────────────────── */}
      <Dialog open={!!pauseQuote} onOpenChange={() => setPauseQuote(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("crmFollowup.pauseDialog.title")}</DialogTitle>
          </DialogHeader>
          {pauseQuote && (
            <div className="space-y-4">
              <div className="text-xs text-foreground/60 bg-foreground/[0.04] rounded-lg p-3">
                <span className="font-mono text-warning">{pauseQuote.quoteNumber}</span> · {pauseQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("crmFollowup.pauseDialog.reason")}</Label>
                <Input value={pauseReason} onChange={e => setPauseReason(e.target.value)} className="text-xs h-8"
                  placeholder={t("crmFollowup.pauseDialog.placeholder")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPauseQuote(null)}>{t("crmFollowup.pauseDialog.cancel")}</Button>
            <Button size="sm" className="bg-warning hover:bg-warning text-background"
              disabled={pauseReminders.isPending}
              onClick={() => pauseReminders.mutate({ quoteId: pauseQuote.id, reason: pauseReason || undefined })}>
              <Pause className="w-3.5 h-3.5 mr-1" /> {t("crmFollowup.pauseDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Crear/Editar regla eliminado en Fase 4.
          Las reglas comerciales se gestionan ahora en la pestaña "Plantillas". */}
    </AdminLayout>
  );
}
