import React, { useState, useMemo, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
  Map, Zap, ClipboardCheck, Search, MoreHorizontal,
} from "lucide-react";
import { NOTIF_POPUP_KEY, NOTIF_SOUND_KEY } from "@/components/WhatsAppNotification";
import CommunicationsMap from "./CommunicationsMap";
import LegacyAutomationsTab from "./LegacyAutomationsTab";
import EmailAuditTab from "./EmailAuditTab";
import TemplateRulesTab from "./TemplateRulesTab";
import PendingJobsTab from "./PendingJobsTab";
import { toastError } from "@/lib/errorMessage";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CompactEmpty, SummaryStrip, ToolbarRow, SCROLL_NAV, TAB_BASE, TAB_ON, TAB_OFF, useScrollFade } from "@/components/admin/SalesFamilyShell";
import { cn } from "@/lib/utils";
import { PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "open" | "history" | "mapa" | "automatizaciones" | "auditoria" | "plantillas" | "cola";

/** Estado comercial de cada presupuesto → significado (color por tono, no por módulo). */
const COMMERCIAL_STATUS_TONE: Record<string, Tone> = {
  pending_followup: "neutral",
  reminder_1_sent: "brand",
  reminder_2_sent: "brand",
  reminder_3_sent: "brand",
  interested: "success",
  paused: "warning",
  lost: "danger",
  converted: "success",
  discarded: "neutral",
};

function CommercialStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  const key = status && COMMERCIAL_STATUS_TONE[status] ? status : "pending_followup";
  return <StatusBadge tone={COMMERCIAL_STATUS_TONE[key]}>{t(`crmFollowup.status.${key}`)}</StatusBadge>;
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

const TONE_HOVER: Record<Tone, string> = {
  success: "hover:text-success", warning: "hover:text-warning", danger: "hover:text-danger",
  info: "hover:text-info", neutral: "hover:text-foreground", brand: "hover:text-primary",
};

/** Botón de icono de una fila: tamaño táctil, nombre accesible y tono al pasar el ratón. */
function RowAction({ label, tone = "neutral", onClick, href, children }: {
  label: string; tone?: Tone; onClick?: () => void; href?: string; children: React.ReactNode;
}) {
  const cls = `inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${TONE_HOVER[tone]}`;
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={label} aria-label={label} className={cls}>{children}</a>
  ) : (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={cls}>{children}</button>
  );
}

/** Columnas comunes de presupuestos (panel y abiertos): tabla desde 768 px y tarjetas en móvil. */
function useQuoteColumns(onAction: (action: string, quote: any) => void, withNext: boolean): PanelColumn<any>[] {
  const { t, format } = useI18n();
  return [
    {
      key: "quote", header: t("crmFollowup.col.quote"),
      cell: (q) => (
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold text-primary">{q.quoteNumber}</span>
          {q.title && <span className="block max-w-[200px] lg:max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-normal text-muted-foreground">{q.title}</span>}
        </div>
      ),
    },
    {
      key: "client", header: t("crmFollowup.col.client"),
      cell: (q) => (
        <div className="min-w-0">
          <span className="block max-w-[200px] lg:max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground">{q.clientName ?? "—"}</span>
          {q.clientEmail && <span className="block max-w-[200px] lg:max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{q.clientEmail}</span>}
        </div>
      ),
    },
    {
      key: "sent", header: t("crmFollowup.col.sent"),
      cell: (q) => {
        const days = daysSince(q.sentAt);
        return (
          <div className="text-sm">
            <span className="text-foreground">{fmtDate(format, q.sentAt)}</span>
            {days !== null && <span className="ml-1.5 text-xs text-muted-foreground">{t("crmFollowup.daysAgo", { days })}</span>}
            <span className={`mt-0.5 flex items-center gap-1 text-xs max-lg:justify-end ${q.viewedAt ? "text-info" : "text-muted-foreground"}`}>
              {q.viewedAt ? <Eye className="h-3 w-3" aria-hidden="true" /> : <EyeOff className="h-3 w-3" aria-hidden="true" />}
              {q.viewedAt ? fmtDate(format, q.viewedAt) : t("crmFollowup.notSeen")}
            </span>
          </div>
        );
      },
    },
    { key: "amount", header: t("crmFollowup.col.amount"), align: "right", cell: (q) => <span className="font-semibold tabular-nums text-foreground">{format.currency(Number(q.total ?? 0))}</span> },
    {
      key: "status", header: t("crmFollowup.col.status"),
      cell: (q) => (
        <div className="text-sm max-lg:flex max-lg:flex-col max-lg:items-end">
          <CommercialStatusBadge status={q.commercialStatus} />
          <span className="mt-1 block text-xs text-muted-foreground">{t("crmFollowup.remindersCount", { n: q.trackingReminderCount ?? q.reminderCount ?? 0 })}</span>
          {withNext && <span className="block text-xs text-muted-foreground">{q.nextScheduledAt ? `${t("crmFollowup.col.nextSend")}: ${fmtDateTime(format, q.nextScheduledAt)}` : t("crmFollowup.noNext")}</span>}
        </div>
      ),
    },
    {
      key: "actions", header: <span className="sr-only">{t("crmFollowup.col.actions")}</span>, align: "right",
      cell: (q) => (
        <div className="flex items-center justify-end gap-0.5">
          <RowAction onClick={() => onAction("remind", q)} label={t("crmFollowup.sendReminder")} tone="brand"><Send className="h-4 w-4" aria-hidden="true" /></RowAction>
          <RowAction onClick={() => onAction("interested", q)} label={t("crmFollowup.markInterested")} tone="success"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></RowAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t("crmFollowup.moreActions")} title={t("crmFollowup.moreActions")} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {q.paymentLinkUrl && <DropdownMenuItem asChild><a href={q.paymentLinkUrl} target="_blank" rel="noopener noreferrer"><Eye className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmFollowup.viewQuote")}</a></DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => onAction("note", q)}><StickyNote className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmFollowup.addNote")}</DropdownMenuItem>
              {q.reminderPaused
                ? <DropdownMenuItem onSelect={() => onAction("resume", q)}><Play className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmFollowup.resume")}</DropdownMenuItem>
                : <DropdownMenuItem onSelect={() => onAction("pause", q)}><Pause className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmFollowup.pause")}</DropdownMenuItem>}
              <DropdownMenuItem variant="destructive" onSelect={() => onAction("lost", q)}><XCircle className="mr-2 h-4 w-4" aria-hidden="true" />{t("crmFollowup.markLost")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];
}

/** Interruptor accesible (role=switch) para las preferencias de aviso del navegador. */
function PrefSwitch({ checked, onChange, label, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${checked ? "left-4" : "left-0.5"}`} />
      </span>
      <span className={`flex items-center gap-1.5 [&_svg]:h-3.5 [&_svg]:w-3.5 ${checked ? "text-foreground" : "text-muted-foreground"}`}>{icon}{label}</span>
    </button>
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

  const { data: openData, isLoading: openLoading, error: openError, refetch: refetchOpen } =
    trpc.commercialFollowup.listOpen.useQuery(
      { search: openSearch || undefined, commercialStatus: openStatus === "all" ? undefined : openStatus || undefined, viewed: openViewed, limit: 100, offset: 0 },
      { enabled: tab === "open" }
    );

  const { data: historyData, isLoading: histLoading, error: histError, refetch: refetchHist } =
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
  const tabScroll = useScrollFade<HTMLDivElement>(tab);
  const [, setLocation] = useLocation();
  const quoteColumns = useQuoteColumns(handleAction, true);
  const attention = dashboard?.attentionList ?? [];
  const openRows = openData?.rows ?? [];
  const historyRows = historyData?.rows ?? [];
  const goOpen = (status: string, viewed: "all" | "yes" | "no") => { setOpenStatus(status); setOpenViewed(viewed); setTab("open"); };

  const historyColumns: PanelColumn<any>[] = [
    { key: "quote", header: t("crmFollowup.col.quote"), cell: (c) => <span className="font-mono text-sm font-semibold text-primary">{c.quoteNumber ?? `#${c.quoteId}`}</span> },
    { key: "date", header: t("crmFollowup.col.date"), cell: (c) => <span className="text-muted-foreground">{fmtDateTime(format, c.sentAt)}</span> },
    { key: "client", header: t("crmFollowup.col.client"), cell: (c) => <span className="text-foreground">{c.clientName ?? c.customerEmail ?? "—"}</span> },
    {
      key: "type", header: t("crmFollowup.col.type"),
      cell: (c) => {
        const tone: Tone = c.type === "automatic_reminder" ? "brand" : c.type === "manual_reminder" ? "info" : c.type === "internal_note" ? "warning" : c.type === "lost_reason" ? "danger" : "neutral";
        const label = c.type === "automatic_reminder" ? t("crmFollowup.history.typeAuto") : c.type === "manual_reminder" ? t("crmFollowup.history.typeManual") : c.type === "internal_note" ? t("crmFollowup.history.typeNote") : c.type === "lost_reason" ? t("crmFollowup.history.typeLost") : c.type;
        return <StatusBadge tone={tone}>{label}</StatusBadge>;
      },
    },
    { key: "subject", header: t("crmFollowup.col.subject"), cell: (c) => <span className="block max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground max-lg:max-w-[180px]">{c.subject ?? "—"}</span> },
    {
      key: "status", header: t("crmFollowup.col.status"),
      cell: (c) => (
        <StatusBadge tone={c.status === "sent" ? "success" : c.status === "failed" ? "danger" : "neutral"}>
          {c.status === "sent" ? t("crmFollowup.history.sent") : c.status === "failed" ? t("crmFollowup.history.failed") : t("crmFollowup.history.skipped")}
        </StatusBadge>
      ),
    },
  ];

  // Pestaña "Configuración" + sus settings locales eliminados en Fase 5.

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <AdminLayout>
      <div className="mx-auto w-full min-w-0 max-w-7xl px-4 pb-6 pt-3">
        {/* Cabecera compacta: título y actualizar en una fila; el subtítulo solo en pantallas anchas */}
        <header className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4"><Target /></span>
            <div className="min-w-0">
              <h1 className="overflow-hidden text-ellipsis whitespace-nowrap text-lg font-semibold leading-tight text-foreground">{t("crmFollowup.title")}</h1>
              <p className="hidden overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground lg:block">{t("crmFollowup.subtitle")}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="icon" className="shrink-0" aria-label={t("panelStates.retry")} onClick={() => { refetchDash(); refetchOpen(); }}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <WorkplaceLocks place="crm" className="mb-3" />

        {/* Pestañas: pastillas con desplazamiento suave y desvanecido; la activa va con el color de la marca y «Abiertos» avisa de lo que pide atención */}
        <div className="mb-4 flex min-w-0">
          <div ref={tabScroll.ref} onScroll={tabScroll.onScroll} style={tabScroll.style} className={`${SCROLL_NAV} flex-1`}>
            <div role="tablist" aria-label={t("crmFollowup.tabsLabel")} className="inline-flex min-w-max gap-0.5 rounded-xl border border-border bg-card/80 p-1 shadow-sm">
              {tabs.map(tb => (
                <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} data-active={tab === tb.id} onClick={() => setTab(tb.id)}
                  className={cn(TAB_BASE, tab === tb.id ? TAB_ON : TAB_OFF)}>
                  <tb.icon className="h-4 w-4" aria-hidden="true" />
                  {tb.label}
                  {tb.id === "open" && (kpis?.needsAttention ?? 0) > 0 && (
                    <span title={t("crmFollowup.kpi.needsAttention")} className="rounded-full bg-warning/15 px-1.5 text-xs font-semibold tabular-nums text-warning">{kpis?.needsAttention}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
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
                {/* Presupuestos: lo que pide atención (clave) y cómo está el resto; las primeras cifras filtran la lista de abiertos */}
                <section aria-labelledby="seg-quotes" className="space-y-2">
                  <h2 id="seg-quotes" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("crmFollowup.section.quotes")}</h2>
                  <div className="grid gap-2">
                    <SummaryStrip label={t("crmFollowup.section.quotes")} items={[
                      { key: "attention", label: t("crmFollowup.kpi.needsAttention"), value: kpis?.needsAttention ?? 0, detail: t("crmFollowup.kpi.activeQuotes"), primary: true, tone: (kpis?.needsAttention ?? 0) > 0 ? "warning" : "success", onClick: () => setTab("open") },
                      { key: "notViewed", label: t("crmFollowup.kpi.notViewed"), value: kpis?.notViewed ?? 0, tone: "neutral", onClick: () => goOpen("all", "no") },
                      { key: "viewed", label: t("crmFollowup.kpi.viewedUnpaid"), value: kpis?.viewed ?? 0, tone: "info", onClick: () => goOpen("all", "yes") },
                      { key: "paused", label: t("crmFollowup.kpi.paused"), value: kpis?.paused ?? 0, tone: "warning", onClick: () => goOpen("paused", "all") },
                    ]} />
                    <SummaryStrip label={t("crmFollowup.section.quotes")} items={[
                      { key: "sent", label: t("crmFollowup.kpi.sentToday"), value: kpis?.sentToday ?? 0, detail: t("crmFollowup.kpi.autoReminders"), tone: "brand" },
                      { key: "cold", label: t("crmFollowup.kpi.cold"), value: kpis?.cold ?? 0, tone: "neutral" },
                      { key: "converted", label: t("crmFollowup.kpi.converted"), value: kpis?.converted ?? 0, tone: "success" },
                      { key: "lost", label: t("crmFollowup.kpi.lost"), value: kpis?.lost ?? 0, tone: "danger" },
                    ]} />
                  </div>
                </section>

                {/* Canales de entrada: WhatsApp y llamadas solo con su módulo contratado */}
                <section aria-labelledby="seg-channels" className="space-y-2">
                  <h2 id="seg-channels" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("crmFollowup.section.channels")}</h2>
                  <SummaryStrip label={t("crmFollowup.section.channels")} items={[
                    ...(hasWhatsApp ? [
                      { key: "wa1", label: t("crmFollowup.kpi.whatsappToday"), value: whatsappStats?.conversations?.newToday ?? 0, tone: "success" as const },
                      { key: "wa2", label: t("crmFollowup.kpi.whatsappUnread"), value: whatsappStats?.conversations?.unread ?? 0, tone: "info" as const },
                    ] : []),
                    ...(hasVoice ? [
                      { key: "vo1", label: t("crmFollowup.kpi.callsToday"), value: vapiStats?.today ?? 0, tone: "brand" as const },
                      { key: "vo2", label: t("crmFollowup.kpi.callsUnreviewed"), value: vapiStats?.unreviewed ?? 0, tone: "warning" as const },
                    ] : []),
                    { key: "em1", label: t("crmFollowup.kpi.emailsToday"), value: emailStats?.receivedToday ?? 0, tone: "info" as const, onClick: () => setLocation("/admin/atencion-comercial/email") },
                    { key: "em2", label: t("crmFollowup.kpi.emailsUnread"), value: emailStats?.unreadInbox ?? 0, tone: "warning" as const, onClick: () => setLocation("/admin/atencion-comercial/email") },
                    { key: "em3", label: t("crmFollowup.kpi.emailsSent"), value: emailStats?.sent ?? 0, tone: "info" as const, onClick: () => setLocation("/admin/atencion-comercial/email?folder=sent") },
                  ]} />
                </section>

                {/* Avisos de WhatsApp en este navegador */}
                {hasWhatsApp && (
                  <section aria-labelledby="seg-notif" className="rounded-xl border border-border bg-card p-4">
                    <h2 id="seg-notif" className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
                      {t("crmFollowup.notif.title")}
                    </h2>
                    <p className="mb-2 text-xs text-muted-foreground">{t("crmFollowup.notif.hint")}</p>
                    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-6">
                      <PrefSwitch checked={!popupDisabled} onChange={(v) => setPopupDisabled(!v)} label={popupDisabled ? t("crmFollowup.notif.popupOff") : t("crmFollowup.notif.popupOn")} icon={popupDisabled ? <BellOff /> : <Bell />} />
                      <PrefSwitch checked={!soundDisabled} onChange={(v) => setSoundDisabled(!v)} label={soundDisabled ? t("crmFollowup.notif.soundOff") : t("crmFollowup.notif.soundOn")} icon={soundDisabled ? <VolumeX /> : <Volume2 />} />
                    </div>
                  </section>
                )}

                {/* Presupuestos que piden atención */}
                <section aria-labelledby="seg-attention" className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="seg-attention" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
                      {t("crmFollowup.attention.title")}
                    </h2>
                  </div>
                  {attention.length === 0 ? (
                    <CompactEmpty icon={<CheckCircle2 />} title={t("crmFollowup.attention.empty")} description={t("crmFollowup.attention.emptyHint")} />
                  ) : (
                    <PanelDataList rows={attention} columns={quoteColumns} rowKey={(q) => q.id} caption={t("crmFollowup.attention.title")} tableFrom="lg" />
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {/* ── TAB: OPEN QUOTES ────────────────────────────────────────────── */}
        {tab === "open" && (
          <div className="space-y-4">
            <ToolbarRow
              search={{ value: openSearch, onChange: setOpenSearch, placeholder: t("crmFollowup.open.search") }}
              filters={<>
                <Select value={openStatus} onValueChange={setOpenStatus}>
                  <SelectTrigger className="h-9 w-full bg-card sm:w-52" aria-label={t("crmFollowup.open.statusPlaceholder")}>
                    <SelectValue placeholder={t("crmFollowup.open.statusPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("crmFollowup.open.allStatuses")}</SelectItem>
                    {Object.keys(COMMERCIAL_STATUS_TONE).map((k) => (
                      <SelectItem key={k} value={k}>{t(`crmFollowup.status.${k}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={openViewed} onValueChange={v => setOpenViewed(v as any)}>
                  <SelectTrigger className="h-9 w-full bg-card sm:w-44" aria-label={t("crmFollowup.col.seen")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("crmFollowup.open.all")}</SelectItem>
                    <SelectItem value="yes">{t("crmFollowup.open.viewed")}</SelectItem>
                    <SelectItem value="no">{t("crmFollowup.open.notViewed")}</SelectItem>
                  </SelectContent>
                </Select>
              </>}
              summary={!openLoading && !openError ? t("crmFollowup.open.count", { n: openData?.total ?? 0 }) : undefined}
            />

            {openLoading ? (
              <PanelLoading />
            ) : openError ? (
              <PanelError title={t("crmFollowup.loadError")} error={openError} onRetry={() => void refetchOpen()} />
            ) : openRows.length === 0 ? (
              <CompactEmpty icon={<List />} title={t("crmFollowup.open.empty")} description={t("crmFollowup.open.emptyHint")} />
            ) : (
              <PanelDataList rows={openRows} columns={quoteColumns} rowKey={(q) => q.id} caption={t("crmFollowup.tab.open")} tableFrom="lg" />
            )}
          </div>
        )}

        {/* ── TAB: HISTORY ────────────────────────────────────────────────── */}
        {tab === "history" && (
          <div className="space-y-4">
            {!histLoading && !histError && <p className="text-sm text-muted-foreground">{t("crmFollowup.history.count", { n: historyData?.total ?? 0 })}</p>}
            {histLoading ? (
              <PanelLoading />
            ) : histError ? (
              <PanelError title={t("crmFollowup.loadError")} error={histError} onRetry={() => void refetchHist()} />
            ) : historyRows.length === 0 ? (
              <CompactEmpty icon={<History />} title={t("crmFollowup.history.empty")} description={t("crmFollowup.history.emptyHint")} />
            ) : (
              <PanelDataList rows={historyRows} columns={historyColumns} rowKey={(c) => c.id} caption={t("crmFollowup.tab.history")} />
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
      </div>

      {/* ── Modal: Recordatorio manual ─────────────────────────────────────── */}
      <Dialog open={!!remindQuote} onOpenChange={() => setRemindQuote(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("crmFollowup.remind.title")}</DialogTitle>
          </DialogHeader>
          {remindQuote && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-primary">{remindQuote.quoteNumber}</span> · {remindQuote.clientName} · {remindQuote.clientEmail}
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.remind.subject")}</Label>
                <Input value={remindSubject} onChange={e => setRemindSubject(e.target.value)} className="h-10"
                  placeholder={t("crmFollowup.remind.subjectPlaceholder")} />
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.remind.body")}</Label>
                <Textarea value={remindBody} onChange={e => setRemindBody(e.target.value)} rows={4} 
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
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-primary">{noteQuote.quoteNumber}</span> · {noteQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.note.channel")}</Label>
                <Select value={noteChannel} onValueChange={v => setNoteChannel(v as any)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">{t("crmFollowup.note.internal")}</SelectItem>
                    <SelectItem value="phone">{t("crmFollowup.note.phone")}</SelectItem>
                    <SelectItem value="whatsapp">{t("crmFollowup.note.whatsapp")}</SelectItem>
                    <SelectItem value="email">{t("crmFollowup.note.email")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.note.note")}</Label>
                <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={3}  />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNoteQuote(null)}>{t("crmFollowup.note.cancel")}</Button>
            <Button size="sm"
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
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-primary">{lostQuote.quoteNumber}</span> · {lostQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.lost.reason")}</Label>
                <Textarea value={lostReason} onChange={e => setLostReason(e.target.value)} rows={2} 
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
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <span className="font-mono font-semibold text-primary">{pauseQuote.quoteNumber}</span> · {pauseQuote.clientName}
              </div>
              <div className="space-y-1">
                <Label >{t("crmFollowup.pauseDialog.reason")}</Label>
                <Input value={pauseReason} onChange={e => setPauseReason(e.target.value)} className="h-10"
                  placeholder={t("crmFollowup.pauseDialog.placeholder")} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPauseQuote(null)}>{t("crmFollowup.pauseDialog.cancel")}</Button>
            <Button size="sm"
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
