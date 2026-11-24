import React, { useState, useMemo, useEffect } from "react";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import AdminLayout from "@/components/AdminLayout";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { useVocabulary, visibleCrmTabs } from "@/lib/vocabulary";
import { errorToastMessage } from "@/lib/errorMessage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Users, FileText, CalendarCheck, Calendar, Search, Plus, Send, CheckCircle, XCircle, Clock, Star, AlertTriangle, Filter, Banknote, Receipt, CreditCard, ExternalLink, FilePlus, Gift, AlertCircle, Archive, X, ChevronDown, ChevronUp } from "lucide-react";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { CrmSummary, CrmSummaryCard, CrmFilterBar, CrmFilterField, type CrmFilterChip } from "./shared/ui/CrmUi";
import { useI18n } from "@/i18n/I18nProvider";
import { Tab, ConfirmDialog, CHANNEL_META } from "./shared/crmCommon";
import { BonosManager } from "./tabs/BonosTab";
import { PagosPendientesTab } from "./tabs/PendingPaymentsTab";
import { useLeadsController, LeadsTab, LeadsModals } from "./tabs/LeadsTab";
import { useQuotesController, QuotesTab, QuotesModals } from "./tabs/QuotesTab";
import { useReservationsController, ReservationsTab, ReservationsModals } from "./tabs/ReservationsTab";
import { useInvoicesController, InvoicesTab, InvoicesModals } from "./tabs/InvoicesTab";
import { useCancellationsController, CancellationsTab, CancellationsModals } from "./tabs/CancellationsTab";

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
    border: "border-info",
    activeBorder: "border-info shadow-[0_0_20px_rgba(59,130,246,0.35)]",
    glow: "bg-info/10",
    icon: "text-info",
    number: "text-info",
    label: "text-info/70",
    dot: "bg-info",
  },
  amber: {
    bg: "bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/80 dark:via-amber-900/30 dark:to-[#080e1c]",
    border: "border-warning",
    activeBorder: "border-warning shadow-[0_0_20px_rgba(245,158,11,0.35)]",
    glow: "bg-warning/10",
    icon: "text-warning",
    number: "text-warning",
    label: "text-warning/70",
    dot: "bg-warning",
  },
  green: {
    bg: "bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/80 dark:via-emerald-900/30 dark:to-[#080e1c]",
    border: "border-success",
    activeBorder: "border-success shadow-[0_0_20px_rgba(16,185,129,0.35)]",
    glow: "bg-success/10",
    icon: "text-success",
    number: "text-success",
    label: "text-success/70",
    dot: "bg-success",
  },
  red: {
    bg: "bg-gradient-to-br from-red-50 to-white dark:from-red-950/80 dark:via-red-900/30 dark:to-[#080e1c]",
    border: "border-danger",
    activeBorder: "border-danger shadow-[0_0_20px_rgba(239,68,68,0.35)]",
    glow: "bg-danger/10",
    icon: "text-danger",
    number: "text-danger",
    label: "text-danger/70",
    dot: "bg-danger",
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
    border: "border-warning",
    activeBorder: "border-warning shadow-[0_0_20px_rgba(249,115,22,0.35)]",
    glow: "bg-warning/10",
    icon: "text-warning",
    number: "text-warning",
    label: "text-warning/70",
    dot: "bg-warning",
  },
  indigo: {
    bg: "bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/80 dark:via-indigo-900/30 dark:to-[#080e1c]",
    border: "border-primary",
    activeBorder: "border-primary shadow-[0_0_20px_rgba(99,102,241,0.35)]",
    glow: "bg-primary/10",
    icon: "text-primary",
    number: "text-primary",
    label: "text-primary/70",
    dot: "bg-primary",
  },
  violet: {
    bg: "bg-gradient-to-br from-violet-50 to-white dark:from-violet-950/80 dark:via-violet-900/30 dark:to-[#080e1c]",
    border: "border-primary",
    activeBorder: "border-primary shadow-[0_0_20px_rgba(139,92,246,0.35)]",
    glow: "bg-primary/10",
    icon: "text-primary",
    number: "text-primary",
    label: "text-primary/70",
    dot: "bg-primary",
  },
  purple: {
    bg: "bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/80 dark:via-purple-900/30 dark:to-[#080e1c]",
    border: "border-primary",
    activeBorder: "border-primary shadow-[0_0_20px_rgba(168,85,247,0.35)]",
    glow: "bg-primary/10",
    icon: "text-primary",
    number: "text-primary",
    label: "text-primary/70",
    dot: "bg-primary",
  },
};

function fmtAmount(n: number, format: ReturnType<typeof useI18n>["format"]): string {
  if (n === 0) return "";
  return format.currency(n, "EUR", { maximumFractionDigits: 0 });
}

/** Las etiquetas traducidas de canal llevan emoji; aquí ya hay icono del sistema, así que se omite sin tocar las traducciones. */
const noEmoji = (label: string) => label.replace(new RegExp("^[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]+", "u"), "");

const COUNTER_TONE: Record<keyof typeof COUNTER_STYLES, "brand" | "info" | "success" | "warning" | "danger" | "neutral"> = {
  blue: "info", amber: "warning", green: "success", red: "danger", slate: "neutral", orange: "brand", indigo: "brand", violet: "brand", purple: "brand",
};

/** Contador del circuito comercial: misma tarjeta de métrica del sistema (tonos por significado, no por gradiente). */
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
  const { format } = useI18n();
  const numericValue = typeof value === "number" ? value : null;
  const animated = useCountUp(numericValue ?? 0);
  const money = amount != null && amount > 0 ? fmtAmount(amount, format) : "";
  return (
    <MetricCard
      icon={<Icon />}
      tone={COUNTER_TONE[color] ?? "info"}
      label={label}
      value={numericValue !== null ? animated : value}
      detail={[subtitle, money].filter(Boolean).join(" · ") || undefined}
      onClick={onClick}
      active={active}
    />
  );
}

// ─── MAIN CRM DASHBOARD ───────────────────────────────────────────────────────
export default function CRMDashboard() {
  const { t, format } = useI18n();
  // Empresas con licencias por capacidad: vocabulario genérico (pedidos en lugar de reservas)
  const panelSub = usePanelSubscription();
  const voc = useVocabulary();
  // Pestañas según las licencias de la empresa (igual que el menú); en la instalación propia, todas
  const visibleTabs = useMemo(
    () => visibleCrmTabs(["leads", "quotes", "reservations", "invoices", "anulaciones", "pagos_pendientes", "bonos"] as const, { licensed: panelSub.isLicensed, can: panelSub.can }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelSub.isLicensed, panelSub.data],
  );
  // Sincronizar tab con ?tab= de la URL (reactivo al navegar desde el sidebar)
  const searchStr = useSearch();
  const tabFromSearch = (s: string): Tab => {
    try {
      const raw = new URLSearchParams(s).get("tab");
      // Alias heredados de los enlaces internos (Calendario, Actividades del día): «reservas», «presupuestos», «facturas»
      const t = raw === "reservas" ? "reservations" : raw === "presupuestos" ? "quotes" : raw === "facturas" ? "invoices" : raw;
      if (t === "leads" || t === "quotes" || t === "reservations" || t === "invoices" || t === "anulaciones" || t === "pagos_pendientes" || t === "bonos") return t;
    } catch { /* ignore */ }
    // Rutas directas del panel (/admin/crm/presupuestos, /admin/crm/reservas): abren su pestaña
    const byPath: Record<string, Tab> = { "/admin/crm/presupuestos": "quotes", "/admin/crm/reservas": "reservations" };
    return byPath[window.location.pathname.replace(/\/+$/, "")] ?? "leads";
  };
  const [tab, setTab] = useState<Tab>(() => tabFromSearch(searchStr));
  const [bulkConfirm, setBulkConfirm] = useState<null | "leads" | "quotes" | "reservations">(null);
  // Pestaña no contratada (enlace antiguo o sin ?tab=): se abre la primera disponible
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [visibleTabs, tab]);
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
    try { return localStorage.getItem("crm_kpis_expanded") === "true"; } catch { return false; }
  });
  const toggleKpis = () => setKpisExpanded(prev => {
    const next = !prev;
    try { localStorage.setItem("crm_kpis_expanded", String(next)); } catch {}
    return next;
  });
  const { data: leadCounters } = trpc.crm.leads.counters.useQuery();
  const { data: quoteCounters } = trpc.crm.quotes.counters.useQuery();
  const { data: resCounters } = trpc.crm.reservations.counters.useQuery();
  const { data: upcomingInstallments } = trpc.crm.paymentPlans.upcoming.useQuery({ daysAhead: 7 });
  const { data: leadSourcesData } = trpc.crm.leadSources.list.useQuery();
  // ─── Anular Reserva directa ──────────────────────────────────────────────────
  const [cancelReservationId, setCancelReservationId] = useState<number | null>(null);
  const [cancelReservationName, setCancelReservationName] = useState<string>("");
  const { data: anulCounters } = trpc.cancellations.getCounters.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: voucherCounters } = trpc.cancellations.getVoucherCounters.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const auditQuery = trpc.crm.reservations.auditOrphans.useQuery(undefined, {
    refetchInterval: 120000,
  });
  const { data: auditData } = auditQuery;
  const setInvoiceExempt = trpc.crm.reservations.setInvoiceExempt.useMutation({
    onSuccess: () => {
      toast.success(t("crmDashboard.avisoIgnorado"));
      auditQuery.refetch();
    },
    onError: (e) => toast.error(errorToastMessage(e, "No se ha podido ignorar el aviso.")),
  });
  // Avisos de datáfono y gastos: solo con la conciliación bancaria contratada (sin ella el servidor responde 403)
  const bankLicensed = panelSub.can("bank-import-pos");
  const { data: tpvPaymentAlerts } = trpc.cardTerminalBatches.getCrmPaymentAlerts.useQuery(undefined, {
    enabled: bankLicensed,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: expenseStats } = trpc.bankMovements.getExpenseStats.useQuery(undefined, {
    enabled: bankLicensed,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
  const utils = trpc.useUtils();
  const handleTabChange = (t: Tab) => {
    setTab(t);
    setFilterStatus("all");
    setSearch("");
  };
  const leads = useLeadsController({ filterStatus, search, tab });
  const quotes = useQuotesController({ filterStatus, search, tab });
  const res = useReservationsController({ filterStatus, search, tab });
  const invoices = useInvoicesController({ tab });
  const anul = useCancellationsController({ tab });
  const { selectedLeads, setShowNewLeadModal, leadSourceFilter, setLeadSourceFilter, bulkDeleteLeads } = leads;
  const { selectedQuotes, setShowDirectQuoteModal, bulkDeleteQuotes } = quotes;
  const { selectedRes, setShowNewReservationModal, resChannelFilter, setResChannelFilter, setViewResId, bulkDeleteRes, setGenInvoiceResId } = res;
  const { setNewInvoiceOpen } = invoices;
  const { setSelectedAnulId } = anul;
  // Accesos directos desde el inicio del panel: ?tab=quotes&nuevo=1, ?tab=reservations&nuevo=1, ?tab=invoices&nuevo=1, ?tab=leads&nuevo=1
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("nuevo") !== "1") return;
    const t = url.searchParams.get("tab");
    if (t === "quotes") setShowDirectQuoteModal(true);
    else if (t === "reservations") setShowNewReservationModal(true);
    else if (t === "invoices") setNewInvoiceOpen(true);
    else if (t === "leads" || !t) setShowNewLeadModal(true);
    url.searchParams.delete("nuevo");
    window.history.replaceState({}, "", url.toString());
  }, [searchStr]);

  // ─── Oportunidades y Presupuestos: cabecera, resumen y filtros unificados (C4a) ───
  const unified: boolean = tab === "leads" || tab === "quotes";
  const toggleStatus = (status: string) => setFilterStatus((cur) => (cur === status ? "all" : status));
  const moneyShort = (v: number | string | null | undefined) => format.currency(Number(v) || 0, "EUR", { maximumFractionDigits: 0 });
  const tabsNode = (
        <div className="px-4 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="flex min-w-max gap-1 rounded-xl border border-border bg-muted/50 p-1">
            {([
              { key: "leads", label: voc.leads, icon: Users, count: leadCounters?.total },
              { key: "quotes", label: voc.quotes, icon: FileText, count: quoteCounters?.enviado },
              { key: "reservations", label: voc.orders, icon: CalendarCheck, count: resCounters?.confirmadas },
              { key: "invoices", label: voc.invoices, icon: Receipt, count: undefined },
              { key: "anulaciones", label: voc.cancellations, icon: AlertTriangle, count: anulCounters?.pending },
              { key: "bonos", label: voc.coupons, icon: Gift, count: undefined },
              { key: "pagos_pendientes", label: voc.pendingPayments, icon: Clock, count: undefined },
            ] as const).filter(({ key }) => visibleTabs.includes(key)).map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                type="button"
                aria-pressed={tab === key}
                onClick={() => handleTabChange(key)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground"}`}
              >
                <Icon className="h-4 w-4 sm:hidden 2xl:block" />
                {label}
                {count !== undefined && count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${tab === key ? "bg-primary-foreground/20 text-primary-foreground" : "bg-foreground/[0.08] text-foreground/70"}`}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>
          </div>
        </div>
  );
  const leadStatusLabel: Record<string, string> = { nueva: t("crmLeads.nueva"), enviada: t("crmLeads.enviada"), ganada: t("crmLeads.ganada"), perdida: t("crmLeads.perdida") };
  const quoteStatusLabel: Record<string, string> = {
    borrador: t("crmQuotes.borrador"), enviado: t("crmQuotes.enviado"), visualizado: t("crmQuotes.visualizado"), convertido_carrito: t("crmQuotes.pagoIniciado"),
    pago_fallido: t("crmQuotes.pagoFallido"), aceptado: t("crmQuotes.aceptado"), rechazado: t("crmQuotes.rechazado"), expirado: t("crmQuotes.expirado"), perdido: t("crmQuotes.perdido"),
  };
  const statusLabels = tab === "leads" ? leadStatusLabel : quoteStatusLabel;
  const sourceLabel = leadSourceFilter === "web"
    ? t("crmDashboard.solicitudesWeb")
    : typeof leadSourceFilter === "number" ? ((leadSourcesData ?? []) as any[]).find((s) => s.id === leadSourceFilter)?.name ?? String(leadSourceFilter) : "";
  const filterChips: CrmFilterChip[] = [
    ...(filterStatus !== "all" ? [{ id: "estado", label: `${t("crmOpps.estado")}: ${statusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus("all") }] : []),
    ...(tab === "leads" && leadSourceFilter !== "all" ? [{ id: "origen", label: `${t("crmOpps.origen")}: ${sourceLabel}`, onRemove: () => setLeadSourceFilter("all") }] : []),
    ...(search.trim() ? [{ id: "busqueda", label: t("crmOpps.busqueda", { text: search.trim() }), onRemove: () => setSearch("") }] : []),
  ];
  const clearAllFilters = () => { setFilterStatus("all"); setSearch(""); if (tab === "leads") setLeadSourceFilter("all"); };
  const activeTotal = tab === "leads" ? leads.leadsData?.total : quotes.quotesData?.total;
  const leadsConversion = leadCounters?.total ? Math.round(((leadCounters.ganada ?? 0) / leadCounters.total) * 100) : 0;
  const withAmount = (text: string, amount: number | string | null | undefined) => (Number(amount) > 0 ? `${text} · ${moneyShort(amount)}` : text);
  const summaryNode = tab === "leads" ? (
    <CrmSummary label={t("crmOpps.resumen")}>
      <CrmSummaryCard tone="info" icon={<Users />} label={t("crmOpps.leadsNuevas")} value={leadCounters?.nueva ?? 0}
        detail={withAmount((leadCounters?.sinLeer ?? 0) > 0 ? t("crmOpps.leadsSinLeer", { count: leadCounters?.sinLeer ?? 0 }) : t("crmOpps.leadsNuevasDetalle"), leadCounters?.valorNueva)}
        active={filterStatus === "nueva"} onClick={() => toggleStatus("nueva")} />
      <CrmSummaryCard tone="warning" icon={<Send />} label={t("crmOpps.leadsSeguimiento")} value={leadCounters?.enviada ?? 0}
        detail={withAmount(t("crmOpps.leadsSeguimientoDetalle"), leadCounters?.valorEnviada)} active={filterStatus === "enviada"} onClick={() => toggleStatus("enviada")} />
      <CrmSummaryCard tone="success" icon={<Star />} label={t("crmOpps.leadsGanadas")} value={leadCounters?.ganada ?? 0}
        detail={withAmount(t("crmOpps.leadsGanadasDetalle", { pct: leadsConversion }), leadCounters?.valorGanada)} active={filterStatus === "ganada"} onClick={() => toggleStatus("ganada")} />
      <CrmSummaryCard tone="danger" icon={<XCircle />} label={t("crmOpps.leadsPerdidas")} value={leadCounters?.perdida ?? 0}
        detail={t("crmOpps.leadsPerdidasDetalle")} active={filterStatus === "perdida"} onClick={() => toggleStatus("perdida")} />
    </CrmSummary>
  ) : (
    <CrmSummary label={t("crmOpps.resumen")}>
      <CrmSummaryCard tone="brand" icon={<Clock />} label={t("crmOpps.quotesPendiente")} value={moneyShort(quoteCounters?.importeEnviado)}
        detail={t("crmOpps.quotesPendienteDetalle", { count: quoteCounters?.enviado ?? 0 })} active={filterStatus === "enviado"} onClick={() => toggleStatus("enviado")} />
      <CrmSummaryCard tone="neutral" icon={<FileText />} label={t("crmOpps.quotesBorradores")} value={quoteCounters?.borrador ?? 0}
        detail={withAmount(t("crmOpps.quotesBorradoresDetalle"), quoteCounters?.importeBorrador)} active={filterStatus === "borrador"} onClick={() => toggleStatus("borrador")} />
      <CrmSummaryCard tone="success" icon={<CheckCircle />} label={t("crmOpps.quotesAceptados")} value={quoteCounters?.ganado ?? 0}
        detail={withAmount(t("crmOpps.quotesAceptadosDetalle", { count: quoteCounters?.ganado ?? 0 }), quoteCounters?.importeTotal)} active={filterStatus === "aceptado"} onClick={() => toggleStatus("aceptado")} />
      {(quoteCounters?.pagoFallido ?? 0) > 0 && (
        <CrmSummaryCard tone="danger" icon={<XCircle />} label={t("crmOpps.quotesPagoFallido")} value={quoteCounters?.pagoFallido ?? 0}
          detail={withAmount(t("crmOpps.quotesPagoFallidoDetalle"), quoteCounters?.importePagoFallido)} active={filterStatus === "pago_fallido"} onClick={() => toggleStatus("pago_fallido")} />
      )}
    </CrmSummary>
  );
  const statusOptions = tab === "leads" ? ["nueva", "enviada", "ganada", "perdida"] : ["borrador", "enviado", "visualizado", "convertido_carrito", "pago_fallido", "aceptado", "rechazado", "expirado", "perdido"];
  const headerIcon = tab === "leads" ? <Users /> : <FileText />;
  const newButton = tab === "leads" ? (
    <Button onClick={() => setShowNewLeadModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {voc.newLead}</Button>
  ) : (
    <Button onClick={() => setShowDirectQuoteModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {voc.licensed ? t("crmDashboard.nuevoPresupuesto") : t("crmDashboard.nuevoPresupuesto2")}</Button>
  );
  const filterBarNode = (
    <CrmFilterBar
      search={{ value: search, onChange: setSearch, placeholder: tab === "leads" ? t("crmEmpty.search.leads", { leadsLower: voc.leadsLower }) : t("crmEmpty.search.quotes") }}
      primary={(
        <CrmFilterField label={t("crmOpps.estado")} className="w-full sm:w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="h-9 w-full text-sm" aria-label={t("crmOpps.estado")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crmOpps.todosLosEstados")}</SelectItem>
              {statusOptions.map((s) => <SelectItem key={s} value={s}>{statusLabels[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </CrmFilterField>
      )}
      more={tab === "leads" ? (
        <CrmFilterField label={t("crmOpps.origen")}>
          <Select value={String(leadSourceFilter)} onValueChange={v => setLeadSourceFilter(v === "all" || v === "web" ? v : Number(v))}>
            <SelectTrigger className="h-9 w-full text-sm" aria-label={t("crmOpps.origen")}><SelectValue placeholder={t("crmDashboard.origen")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("crmDashboard.todosLosOrigenes")}</SelectItem>
              <SelectItem value="web">{t("crmDashboard.solicitudesWeb")}</SelectItem>
              {(leadSourcesData ?? []).map((src: any) => (
                <SelectItem key={src.id} value={String(src.id)}><span style={{ color: src.color ?? undefined }}>{src.name}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CrmFilterField>
      ) : undefined}
      chips={filterChips}
      onClear={clearAllFilters}
      summary={filterChips.length > 0 && activeTotal !== undefined ? t("crmOpps.resultados", { count: activeTotal }) : undefined}
    />
  );

  return (
    <AdminLayout title={voc.crmTitle}>
      <div className="flex min-h-screen flex-col bg-background text-foreground dark:bg-[#080e1c]">
        {unified && (
          <>
            {tabsNode}
            <div className="px-4 pt-4 sm:px-6 sm:pt-5">
              <PanelPageHeader
                className="mb-4 border-b-0 pb-0"
                icon={headerIcon}
                title={tab === "leads" ? voc.leads : voc.quotes}
                description={tab === "leads" ? t("crmOpps.leadsDescripcion") : t("crmOpps.quotesDescripcion")}
                actions={newButton}
              />
              {summaryNode}
            </div>
          </>
        )}
        {!unified && (
        <>
        {/* Header compacto: el trabajo va primero; la franja «Amplía tu empresa» pasa al final */}
        <div className="px-4 sm:px-6 pt-3 sm:pt-4 pb-3 border-b border-foreground/[0.08]">
          <div className="flex items-center justify-between mb-1">
            <div>
              {/* El título «Ventas» ya está en la barra superior: aquí solo el recorrido, sin repetirlo */}
              <h1 className="sr-only">{voc.crmTitle}</h1>
              <p className="text-sm text-foreground/60">{voc.crmSubtitle}</p>
            </div>
          </div>
        </div>
        </>
        )}
        <div className="order-last px-4 sm:px-6 pb-6">
          <WorkplaceLocks place="crm" className="mt-3" />
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
            <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-danger/30 bg-danger/8 p-3 space-y-1.5">
              <p className="text-xs font-bold uppercase tracking-wider text-danger flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />{" "}{t("crmDashboard.incidenciasDePagosFraccionados")}</p>
              {overdue.length > 0 && (
                <p className="text-sm text-danger">
                  <strong>{overdue.length}</strong>{" "}{t("crmDashboard.cuota", { n: overdue.length })}{" "}{t("crmDashboard.vencida", { n: overdue.length })}{" "}{t("crmDashboard.sinCobrar", { v: " — " })}{overdue.map(i => i.quoteNumber).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
                </p>
              )}
              {dueToday.length > 0 && (
                <p className="text-sm text-warning">
                  <strong>{dueToday.length}</strong>{" "}{t("crmDashboard.cuota", { n: dueToday.length })}{" "}{t("crmDashboard.venceHoy", { v: " — " })}{dueToday.map(i => i.quoteNumber).filter((v, i, a) => a.indexOf(v) === i).join(", ")}
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
              {!kpisExpanded && !unified && (
                <>
                  {(leadCounters?.ganada ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/20 text-success text-[11px] font-medium">
                      <Star className="w-2.5 h-2.5" />{t("crmDashboard.ganadas", { ganada: leadCounters?.ganada })}</span>
                  )}
                  {(leadCounters?.enviada ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-warning text-[11px] font-medium">
                      <Send className="w-2.5 h-2.5" />{t("crmDashboard.enviadas", { enviada: leadCounters?.enviada })}</span>
                  )}
                  {(resCounters?.confirmadas ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/20 text-success text-[11px] font-medium">
                      <CheckCircle className="w-2.5 h-2.5" />{resCounters?.confirmadas} {voc.ordersLower}
                      {(resCounters?.importeConfirmadas ?? 0) > 0 && <span className="opacity-60">· {format.number(Math.round(resCounters!.importeConfirmadas))} €</span>}
                    </span>
                  )}
                  {(resCounters?.pendientePago ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-warning/10 border border-warning/20 text-warning text-[11px] font-medium">
                      <Clock className="w-2.5 h-2.5" />{t("crmDashboard.pendPago", { pendientePago: resCounters?.pendientePago })}</span>
                  )}
                  {(anulCounters?.pending ?? 0) > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger/10 border border-danger/20 text-danger text-[11px] font-medium">
                      <AlertTriangle className="w-2.5 h-2.5" />{t("crmDashboard.anulaciones", { pending: anulCounters?.pending })}</span>
                  )}
                </>
              )}
              {(kpisExpanded || unified) && (
                <span className="text-xs text-foreground/40 font-medium">{t("crmDashboard.panelDeIndicadores")}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-foreground/40 group-hover:text-foreground/70 transition-colors flex-shrink-0">
              <span className="text-[11px]">{kpisExpanded ? t("crmDashboard.ocultar") : t("crmDashboard.verKpis")}</span>
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
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{voc.licensed ? t("crmDashboard.embudoDeOportunidades") : t("crmDashboard.pipelineDeOportunidades")}</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(leadCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">{leadCounters?.total ?? 0} {voc.licensed ? ((leadCounters?.total ?? 0) === 1 ? t("crmDashboard.oportunidadEnTotal") : t("crmDashboard.oportunidadesEnTotal")) : t("crmDashboard.leadsTotales")}</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label={t("crmDashboard.nuevaOportunidad")}
                value={leadCounters?.nueva ?? 0}
                icon={Users}
                color="blue"
                subtitle={t("crmDashboard.sinGestionar", { leads: voc.leads })}
                amount={leadCounters?.valorNueva}
                active={tab === "leads" && filterStatus === "nueva"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("nueva"); }}
              />
              <CounterCard
                label={t("crmDashboard.oportunidadEnviada")}
                value={leadCounters?.enviada ?? 0}
                icon={Send}
                color="blue"
                subtitle={t("crmDashboard.presupuestoEnCliente")}
                amount={leadCounters?.valorEnviada}
                active={tab === "leads" && filterStatus === "enviada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("enviada"); }}
              />
              <CounterCard
                label={t("crmDashboard.oportunidadGanada")}
                value={leadCounters?.ganada ?? 0}
                icon={Star}
                color="blue"
                subtitle={`${voc.orders} ${voc.agree("confirmados", "confirmadas")}`}
                amount={leadCounters?.valorGanada}
                active={tab === "leads" && filterStatus === "ganada"}
                onClick={() => { handleTabChange("leads"); setFilterStatus("ganada"); }}
              />
              <CounterCard
                label={t("crmDashboard.oportunidadPerdida")}
                value={leadCounters?.perdida ?? 0}
                icon={XCircle}
                color="blue"
                subtitle={t("crmDashboard.descartadasManualmente")}
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
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{t("crmDashboard.presupuestosIngresos")}</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label={t("crmDashboard.enBorrador")}
                value={quoteCounters?.borrador ?? 0}
                icon={FileText}
                color="orange"
                subtitle={t("crmDashboard.pendientesDeEnviar")}
                amount={quoteCounters?.importeBorrador}
                active={tab === "quotes" && filterStatus === "borrador"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("borrador"); }}
              />
              <CounterCard
                label={t("crmDashboard.enviadosAlCliente")}
                value={quoteCounters?.enviado ?? 0}
                icon={Clock}
                color="orange"
                subtitle={t("crmDashboard.esperandoRespuesta")}
                amount={quoteCounters?.importeEnviado}
                active={tab === "quotes" && filterStatus === "enviado"}
                onClick={() => { handleTabChange("quotes"); setFilterStatus("enviado"); }}
              />
              {(quoteCounters?.pagoFallido ?? 0) > 0 && (
                <CounterCard
                  label={t("crmDashboard.pagoFallido")}
                  value={quoteCounters?.pagoFallido ?? 0}
                  icon={XCircle}
                  color="orange"
                  subtitle={t("crmDashboard.recuperables")}
                  amount={quoteCounters?.importePagoFallido}
                  active={tab === "quotes" && filterStatus === "pago_fallido"}
                  onClick={() => { handleTabChange("quotes"); setFilterStatus("pago_fallido"); }}
                />
              )}
              <CounterCard
                label={voc.ordersToday}
                value={resCounters?.hoy ?? 0}
                icon={CalendarCheck}
                color="orange"
                subtitle={voc.agree("Confirmados hoy", "Confirmadas hoy")}
                amount={resCounters?.importeServicioHoy}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label={t("crmDashboard.ingresosTotales")}
                value={`${Number(resCounters?.ingresos ?? 0).toFixed(0)} €`}
                icon={Banknote}
                color="orange"
                subtitle={`${voc.orders} ${voc.agree("pagados", "pagadas")}`}
                onClick={() => handleTabChange("reservations")}
              />
            </div>
          </div>
          {/* Grupo 2b: Reservas */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-green-400 to-green-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{voc.orders}</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(resCounters?.confirmadas ?? 0) > 0 && (
                <span className="text-xs text-muted-foreground">{resCounters?.confirmadas ?? 0} {(resCounters?.confirmadas ?? 0) === 1 ? voc.agree("confirmado", "confirmada") : voc.agree("confirmados", "confirmadas")}</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <CounterCard
                label={voc.agree("Confirmados", "Confirmadas")}
                value={resCounters?.confirmadas ?? 0}
                icon={CheckCircle}
                color="green"
                subtitle={`${voc.orders} ${voc.agree("pagados", "pagadas")}`}
                amount={resCounters?.importeConfirmadas}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label={t("crmDashboard.pendienteDePago")}
                value={resCounters?.pendientePago ?? 0}
                icon={Clock}
                color="green"
                subtitle={t("crmDashboard.esperandoCobro")}
                amount={resCounters?.importePendientePago}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label={voc.todayCounter}
                value={resCounters?.servicioHoy ?? 0}
                icon={CalendarCheck}
                color="green"
                subtitle={voc.todayCounterSubtitle}
                amount={resCounters?.importeServicioHoy}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label={t("crmDashboard.proximos7Dias")}
                value={resCounters?.proximasSemana ?? 0}
                icon={Calendar}
                color="green"
                subtitle={voc.upcomingCounterSubtitle}
                amount={resCounters?.importeProximasSemana}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              <CounterCard
                label={t("crmDashboard.esteMes")}
                value={resCounters?.esteMes ?? 0}
                icon={Banknote}
                color="green"
                subtitle={voc.agree("Confirmados este mes", "Confirmadas este mes")}
                amount={resCounters?.importeEsteMes}
                active={tab === "reservations"}
                onClick={() => handleTabChange("reservations")}
              />
              {(resCounters?.canceladas ?? 0) > 0 && (
                <CounterCard
                  label={voc.agree("Cancelados", "Canceladas")}
                  value={resCounters?.canceladas ?? 0}
                  icon={XCircle}
                  color="green"
                  subtitle={`${voc.orders} ${voc.agree("anulados", "anuladas")}`}
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
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{t("crmDashboard.anulaciones2")}</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
              {(anulCounters?.total ?? 0) > 0 && (
                <span className="text-xs text-foreground/40">{t("crmDashboard.totales", { v: anulCounters?.total ?? 0 })}</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <CounterCard
                label={t("crmDashboard.pendientes")}
                value={anulCounters?.pending ?? 0}
                icon={AlertTriangle}
                color="red"
                subtitle={t("crmDashboard.sinResolver")}
                amount={anulCounters?.importePendiente}
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label={t("crmDashboard.incidencias")}
                value={anulCounters?.incidencias ?? 0}
                icon={AlertCircle}
                color="red"
                subtitle={t("crmDashboard.requierenAtencion")}
                amount={anulCounters?.importeIncidencias}
                active={tab === "anulaciones"}
                onClick={() => handleTabChange("anulaciones")}
              />
              <CounterCard
                label={t("crmDashboard.total")}
                value={anulCounters?.total ?? 0}
                icon={Archive}
                color="red"
                subtitle={t("crmDashboard.todasLasSolicitudes")}
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
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{t("crmDashboard.proximosPagosFraccionados")}</span>
                  <div className="flex-1 h-px bg-foreground/[0.05]" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <CounterCard
                    label={t("crmDashboard.vencenEn7Dias")}
                    value={upcomingInstallments.filter(i => i.status === "pending" && i.dueDate >= today).length}
                    icon={CreditCard}
                    color="violet"
                    subtitle={t("crmDashboard.cuotasPendientes")}
                    amount={upcomingInstallments.filter(i => i.status === "pending" && i.dueDate >= today).reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label={t("crmDashboard.vencenHoy")}
                    value={vencenHoy.length}
                    icon={AlertCircle}
                    color={vencenHoy.length > 0 ? "amber" : "slate"}
                    subtitle={t("crmDashboard.requierenCobro")}
                    amount={vencenHoy.reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label={t("crmDashboard.enDeuda")}
                    value={enDeuda.length}
                    icon={AlertTriangle}
                    color={enDeuda.length > 0 ? "red" : "slate"}
                    subtitle={t("crmDashboard.vencidasSinPagar")}
                    amount={enDeuda.reduce((s, i) => s + i.amountCents, 0) / 100}
                  />
                  <CounterCard
                    label={t("crmDashboard.totalPendiente")}
                    value={`${format.number((totalPendienteCents / 100), { minimumFractionDigits: 0 })} €`}
                    icon={Banknote}
                    color="violet"
                    subtitle={t("crmDashboard.sumaCuotasActivas")}
                  />
                </div>
                {/* Mini-tabla de cuotas próximas */}
                <div className="mt-3 bg-foreground/[0.03] border border-foreground/[0.07] rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-foreground/[0.04] border-b border-foreground/[0.08]">
                        <th className="text-left px-3 py-2 text-foreground/45 font-medium">{t("crmDashboard.presupuesto")}</th>
                        <th className="text-left px-3 py-2 text-foreground/45 font-medium">{t("crmDashboard.cuota2")}</th>
                        <th className="text-right px-3 py-2 text-foreground/45 font-medium">{t("crmDashboard.importe")}</th>
                        <th className="text-center px-3 py-2 text-foreground/45 font-medium">{t("crmDashboard.vencimiento")}</th>
                        <th className="text-center px-3 py-2 text-foreground/45 font-medium">{t("crmDashboard.estado")}</th>
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
                            <td className="px-3 py-2 text-right font-semibold text-white">{format.number((inst.amountCents / 100), { minimumFractionDigits: 2 })} €</td>
                            <td className="px-3 py-2 text-center text-foreground/55">{inst.dueDate}</td>
                            <td className="px-3 py-2 text-center">
                              {isOverdue ? (
                                <span className="bg-danger/15 text-danger border border-danger/25 px-1.5 py-0.5 rounded">{t("crmDashboard.vencida2")}</span>
                              ) : isToday ? (
                                <span className="bg-warning/15 text-warning border border-warning/25 px-1.5 py-0.5 rounded">{t("crmDashboard.hoy")}</span>
                              ) : (
                                <span className="bg-primary/15 text-primary border border-primary/25 px-1.5 py-0.5 rounded">{t("crmDashboard.pendiente")}</span>
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

          {/* Grupo 4: Bonos compensatorios (solo con el módulo de cupones) */}
          {voc.showCoupons && <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-gradient-to-b from-purple-400 to-purple-600" />
              <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{t("crmDashboard.bonosCompensatorios")}</span>
              <div className="flex-1 h-px bg-foreground/[0.05]" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <CounterCard
                label={t("crmDashboard.activos")}
                value={voucherCounters?.activos ?? 0}
                icon={Gift}
                color="purple"
                subtitle={t("crmDashboard.pendientesDeCanjear")}
                amount={voucherCounters?.importePendiente}
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
              <CounterCard
                label={t("crmDashboard.canjeados")}
                value={voucherCounters?.canjeados ?? 0}
                icon={CheckCircle}
                color="purple"
                subtitle={t("crmDashboard.usadosPorClientes")}
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
              <CounterCard
                label={t("crmDashboard.caducados")}
                value={voucherCounters?.caducados ?? 0}
                icon={Clock}
                color="purple"
                subtitle={t("crmDashboard.sinCanjearATiempo")}
                active={tab === "bonos"}
                onClick={() => handleTabChange("bonos")}
              />
            </div>
          </div>}
        </div>

        {/* Barra de ratio de conversión */}
        {(leadCounters?.total ?? 0) > 0 && (
          <div className="px-6 pb-4">
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600" />
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-foreground/50">{t("crmDashboard.ratioDeConversion")}</span>
                  {(leadCounters?.sinLeer ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-xs text-info font-medium">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
                      </span>
                      {t("crmDashboard.sinLeer", { v: leadCounters?.sinLeer ?? 0 })}</span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-foreground/50">
                  <span className="text-success font-bold text-sm">
                    {leadCounters?.total ? Math.round(((leadCounters.ganada ?? 0) / leadCounters.total) * 100) : 0}%
                  </span>
                  <span>{leadCounters?.ganada ?? 0} {(leadCounters?.ganada ?? 0) === 1 ? voc.agreeLead("ganado", "ganada") : voc.agreeLead("ganados", "ganadas")}{" "}{t("crmDashboard.de", { v: leadCounters?.total ?? 0, v2: (leadCounters?.total ?? 0) === 1 ? voc.lead : voc.leadsLower })}</span>
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
                  <div className="w-2.5 h-2.5 rounded-full bg-success" />{t("crmDashboard.ganadas2", { v: leadCounters?.ganada ?? 0 })}</div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-warning/60" />{t("crmDashboard.enviadas2", { v: leadCounters?.enviada ?? 0 })}</div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-info/40" />{t("crmDashboard.nuevas", { v: leadCounters?.nueva ?? 0 })}</div>
                <div className="flex items-center gap-1.5 text-xs text-foreground/50">
                  <div className="w-2.5 h-2.5 rounded-full bg-danger/40" />{t("crmDashboard.perdidas", { v: leadCounters?.perdida ?? 0 })}</div>
              </div>
            </div>
          </div>
        )}
        </div>{/* /KPI colapsable */}

        {/* ── Banner auditoría reservas sin factura / sin REAV ─────────────── */}
        {auditData && (auditData.sinFacturaCount > 0 || auditData.sinReavCount > 0) && (
          <div className="mx-6 mb-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 text-warning font-semibold text-sm">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{voc.agree(t("crmEmpty.audit.reviewM", { ordersLower: voc.ordersLower }), t("crmEmpty.audit.reviewF", { ordersLower: voc.ordersLower }))}</div>
            {auditData.sinFacturaCount > 0 && (() => {
              const cashItems = auditData.sinFactura.filter((r: any) => r.paymentMethod === "efectivo");
              const otherItems = auditData.sinFactura.filter((r: any) => r.paymentMethod !== "efectivo");
              return (
                <>
                  {cashItems.length > 0 && (
                    <div>
                      <p className="text-xs text-info/80 font-medium mb-1">
                        {voc.agree(t("crmEmpty.audit.cashM", { count: cashItems.length, order: voc.order, orders: voc.ordersLower }), t("crmEmpty.audit.cashF", { count: cashItems.length, order: voc.order, orders: voc.ordersLower }))}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {cashItems.map((r: any) => (
                          <span key={r.id} className="inline-flex items-center text-[11px] bg-info/40 text-info rounded overflow-hidden">
                            <button
                              onClick={() => setGenInvoiceResId(r.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-info/60 transition-colors cursor-pointer"
                              title={voc.agree(t("crmEmpty.hint.cashInvoiceM", { order: voc.order }), t("crmEmpty.hint.cashInvoiceF", { order: voc.order }))}
                            >
                              <span className="font-mono font-bold">{r.reservationNumber ?? `#${r.id}`}</span>
                              <span className="text-info/60">·</span>
                              <span>{r.customerName}</span>
                              {r.amountEur > 0 && <span className="text-info/70">{fmtAmount(r.amountEur, format)}</span>}
                              <FilePlus className="w-3 h-3 text-info ml-0.5" />
                            </button>
                            <button
                              onClick={() => setInvoiceExempt.mutate({ reservationId: r.id, exempt: true })}
                              className="px-1.5 py-1 hover:bg-info/60 text-info hover:text-info transition-colors border-l border-info/40"
                              title={t("crmDashboard.ignorarMarcarComoNo")}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {otherItems.length > 0 && (
                    <div>
                      <p className="text-xs text-warning/80 font-medium mb-1">
                        {voc.agree(t("crmEmpty.audit.otherM", { count: otherItems.length, order: voc.order, orders: voc.ordersLower }), t("crmEmpty.audit.otherF", { count: otherItems.length, order: voc.order, orders: voc.ordersLower }))}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {otherItems.map((r: any) => (
                          <span key={r.id} className="inline-flex items-center text-[11px] bg-warning/40 text-warning rounded overflow-hidden">
                            <button
                              onClick={() => setGenInvoiceResId(r.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-warning/60 transition-colors cursor-pointer"
                              title={voc.agree(t("crmEmpty.hint.invoiceM", { order: voc.order }), t("crmEmpty.hint.invoiceF", { order: voc.order }))}
                            >
                              <span className="font-mono font-bold">{r.reservationNumber ?? `#${r.id}`}</span>
                              <span className="text-warning/60">·</span>
                              <span>{r.customerName}</span>
                              {r.amountEur > 0 && <span className="text-warning/70">{fmtAmount(r.amountEur, format)}</span>}
                              <FilePlus className="w-3 h-3 text-warning ml-0.5" />
                            </button>
                            <button
                              onClick={() => setInvoiceExempt.mutate({ reservationId: r.id, exempt: true })}
                              className="px-1.5 py-1 hover:bg-warning/60 text-warning hover:text-warning transition-colors border-l border-warning/40"
                              title={t("crmDashboard.ignorarMarcarComoNo")}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
            {voc.showReav && auditData.sinReavCount > 0 && (
              <div>
                <p className="text-xs text-warning/80 font-medium mb-1">
                  {t("crmDashboard.reserva", { sinReavCount: auditData.sinReavCount })}{" "}{t("crmDashboard.reavSinExpedienteRevisar")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {auditData.sinReav.map(r => (
                    <button
                      key={r.id}
                      onClick={() => { handleTabChange("reservations"); setViewResId(r.id); }}
                      className="inline-flex items-center gap-1.5 text-[11px] bg-warning/40 hover:bg-warning/60 text-warning rounded px-2 py-1 transition-colors cursor-pointer"
                      title={t("crmDashboard.verReserva")}
                    >
                      <span className="font-mono font-bold">{r.reservationNumber ?? `#${r.id}`}</span>
                      <span className="text-warning/60">·</span>
                      <span>{r.customerName}</span>
                      <ExternalLink className="w-3 h-3 text-warning ml-0.5" />
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
          <div className="mx-4 sm:mx-6 mb-2 rounded-xl border border-info/30 bg-info/8 px-4 py-3 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-info font-semibold text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{t("crmDashboard.coherenciaFinancieraIncidencia")}</div>
            {(tpvPaymentAlerts?.unlinkedTpvOps ?? 0) > 0 && (
              <a href="/admin/contabilidad/operaciones-tpv" className="text-xs text-info/80 hover:text-info transition-colors">{t("crmDashboard.operacion", { unlinkedTpvOps: tpvPaymentAlerts!.unlinkedTpvOps })}{" "}{t("crmDashboard.tpvSinVincularA", { order: voc.order })}</a>
            )}
            {(tpvPaymentAlerts?.staleFailedPayments ?? 0) > 0 && (
              <span className="text-xs text-warning/80">{t("crmDashboard.presupuesto2", { staleFailedPayments: tpvPaymentAlerts!.staleFailedPayments })}{" "}{t("crmDashboard.conPagoFallidoSin")}</span>
            )}
            {(expenseStats?.candidatesCount ?? 0) > 0 && (
              <a href="/admin/contabilidad/gastos" className="text-xs text-primary/80 hover:text-primary transition-colors">{t("crmDashboard.cargo", { candidatesCount: expenseStats!.candidatesCount })}{" "}{t("crmDashboard.sinRegistrarComoGasto")}</a>
            )}
            {(expenseStats?.staleExpensesCount ?? 0) > 0 && (
              <a href="/admin/contabilidad/gastos" className="text-xs text-warning/80 hover:text-warning transition-colors">{t("crmDashboard.gasto", { staleExpensesCount: expenseStats!.staleExpensesCount })}{" "}{t("crmDashboard.sinJustificar30Dias")}</a>
            )}
          </div>
        )}

        {!unified && tabsNode}

        {/* Search & filter */}
        {unified && (
          <div className="px-4 sm:px-6 py-3 sm:py-4">{filterBarNode}</div>
        )}
        {!unified && tab !== "anulaciones" && tab !== "bonos" && tab !== "invoices" && (
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("crmDashboard.buscar")}
              placeholder={tab === "leads" ? t("crmEmpty.search.leads", { leadsLower: voc.leadsLower }) : tab === "quotes" ? t("crmEmpty.search.quotes") : tab === "reservations" ? t("crmEmpty.search.orders", { ordersLower: voc.ordersLower }) : t("crmEmpty.search.invoices")}
              className="pl-9"
            />
          </div>
          {filterStatus !== "all" && (
            <Button size="sm" variant="outline" className="border-warning/30 text-warning hover:bg-warning/10 text-xs" onClick={() => setFilterStatus("all")}>
              <Filter className="w-3.5 h-3.5 mr-1" />{" "}{t("crmDashboard.limpiarFiltro")}</Button>
          )}
          {/* Filtro por canal — visible solo en el tab de reservas */}
          {tab === "reservations" && (
            <Select value={resChannelFilter} onValueChange={setResChannelFilter}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-40">
                <SelectValue placeholder={t("crmDashboard.canal")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmDashboard.todosLosCanales")}</SelectItem>
                <SelectItem value="TPV_FISICO" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.TPV_FISICO.tone}`}>{(() => { const I = CHANNEL_META.TPV_FISICO.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.tpvPresencial"))}</span></SelectItem>
                <SelectItem value="ONLINE_DIRECTO" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.ONLINE_DIRECTO.tone}`}>{(() => { const I = CHANNEL_META.ONLINE_DIRECTO.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.onlineDirecto"))}</span></SelectItem>
                <SelectItem value="ONLINE_ASISTIDO" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.ONLINE_ASISTIDO.tone}`}>{(() => { const I = CHANNEL_META.ONLINE_ASISTIDO.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.onlineAsistido"))}</span></SelectItem>
                <SelectItem value="VENTA_DELEGADA" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.VENTA_DELEGADA.tone}`}>{(() => { const I = CHANNEL_META.VENTA_DELEGADA.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.crmDelegado"))}</span></SelectItem>
                <SelectItem value="TELEFONO" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.TELEFONO.tone}`}>{(() => { const I = CHANNEL_META.TELEFONO.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.telefono"))}</span></SelectItem>
                <SelectItem value="EMAIL" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.EMAIL.tone}`}>{(() => { const I = CHANNEL_META.EMAIL.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.email"))}</span></SelectItem>
                <SelectItem value="PARTNER" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.PARTNER.tone}`}>{(() => { const I = CHANNEL_META.PARTNER.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.partner"))}</span></SelectItem>
                <SelectItem value="TICKETING" className="text-xs"><span className="inline-flex items-center gap-2"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${CHANNEL_META.TICKETING.tone}`}>{(() => { const I = CHANNEL_META.TICKETING.Icon; return <I className="h-3 w-3" aria-hidden />; })()}</span>{noEmoji(t("crmDashboard.ticketing"))}</span></SelectItem>
                <SelectItem value="coupon" className="text-warning text-xs">{t("crmDashboard.cuponOrigen")}</SelectItem>
                <SelectItem value="MANUAL" className="text-foreground/60 text-xs">{t("crmDashboard.manualOtro")}</SelectItem>
                <SelectItem value="API" className="text-foreground/60 text-xs">{t("crmDashboard.api")}</SelectItem>
              </SelectContent>
            </Select>
          )}
          {/* Filtro por origen — visible solo en el tab de leads */}
          {tab === "leads" && (
            <Select value={String(leadSourceFilter)} onValueChange={v => setLeadSourceFilter(v === "all" || v === "web" ? v : Number(v))}>
              <SelectTrigger className="h-9 w-full text-xs sm:w-44">
                <SelectValue placeholder={t("crmDashboard.origen")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-foreground/70 text-xs">{t("crmDashboard.todosLosOrigenes")}</SelectItem>
                {/* Solicitudes de información o de plaza hechas desde la ficha de un producto */}
                <SelectItem value="web" className="text-info text-xs">{t("crmDashboard.solicitudesWeb")}</SelectItem>
                {(leadSourcesData ?? []).map((src: any) => (
                  <SelectItem key={src.id} value={String(src.id)} className="text-xs">
                    <span style={{ color: src.color ?? undefined }}>{src.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Botones de creación manual — visibles según el tab activo */}
          {tab === "leads" && (
            <Button
              size="sm"
              onClick={() => setShowNewLeadModal(true)}
              className="sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> {voc.newLead}
            </Button>
          )}
          {tab === "reservations" && (
            <Button
              size="sm"
              onClick={() => setShowNewReservationModal(true)}
              className="sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> {voc.newOrder}
            </Button>
          )}
          {tab === "quotes" && (
            <Button
              size="sm"
              onClick={() => setShowDirectQuoteModal(true)}
              className="sm:ml-auto"
            >
              <Plus className="w-4 h-4 mr-1.5" /> {voc.licensed ? t("crmDashboard.nuevoPresupuesto") : t("crmDashboard.nuevoPresupuesto2")}
            </Button>
          )}
        </div>
        )}

        {/* Table */}
        <div className="px-4 sm:px-6 pb-8">
          <LeadsTab ctrl={leads} tab={tab} setBulkConfirm={setBulkConfirm} filterStatus={filterStatus} search={search} setFilterStatus={setFilterStatus} setSearch={setSearch} />

          <QuotesTab ctrl={quotes} tab={tab} setBulkConfirm={setBulkConfirm} filterStatus={filterStatus} search={search} setFilterStatus={setFilterStatus} setSearch={setSearch} />

          <ReservationsTab ctrl={res} tab={tab} setBulkConfirm={setBulkConfirm} filterStatus={filterStatus} search={search} setFilterStatus={setFilterStatus} setSearch={setSearch} setTab={setTab} setInvoiceSearch={invoices.setInvoiceSearch} setCancelReservationId={setCancelReservationId} setCancelReservationName={setCancelReservationName} />

          <InvoicesTab ctrl={invoices} tab={tab} />
          
          <CancellationsTab ctrl={anul} tab={tab} setViewResId={res.setViewResId} />
          

          {/* ─── TAB: Pagos Pendientes ─── */}
          {tab === "bonos" && (
            <BonosManager onOpenCancellation={(id) => { setSelectedAnulId(id); }} onOpenReservation={(id) => setViewResId(id)} />
          )}

          {tab === "pagos_pendientes" && (
            <PagosPendientesTab />
          )}
        </div>
      </div>

      <InvoicesModals ctrl={invoices} />

      
      
      

      
      

      
      

      <QuotesModals ctrl={quotes} />
      
      <LeadsModals ctrl={leads} />
      
      <ReservationsModals ctrl={res} setCancelReservationId={setCancelReservationId} setCancelReservationName={setCancelReservationName} />
      

      
      

      

      

      

      
      

      {/* Confirmación de eliminación masiva */}
      <ConfirmDialog
        open={bulkConfirm !== null}
        title={t("crmInvoices.eliminarDefinitivamente")}
        description={
          bulkConfirm === "leads" ? t("crmInvoices.seEliminaranEstaAccion", { size: selectedLeads.size, leadsLower: voc.leadsLower })
          : bulkConfirm === "quotes" ? t("crmInvoices.seEliminaranPresupuestosEsta", { size: selectedQuotes.size })
          : t("crmEmpty.confirm.deleteOrders", { size: selectedRes.size, ordersLower: voc.ordersLower, paid: voc.licensed ? t("crmInvoices.losPedidosPagados") : t("crmInvoices.lasReservasPagadas") })
        }
        onCancel={() => setBulkConfirm(null)}
        onConfirm={() => {
          const which = bulkConfirm;
          setBulkConfirm(null);
          if (which === "leads") bulkDeleteLeads.mutate({ ids: Array.from(selectedLeads) });
          else if (which === "quotes") bulkDeleteQuotes.mutate({ ids: Array.from(selectedQuotes) });
          else if (which === "reservations") bulkDeleteRes.mutate({ ids: Array.from(selectedRes) });
        }}
      />

      
      

      
      

      
      
      
      

      
      

      
      

      
      

      
      

      
      

      
      

      
      

      <CancellationsModals ctrl={anul} handleTabChange={handleTabChange} setViewResId={res.setViewResId} cancelReservationId={cancelReservationId} cancelReservationName={cancelReservationName} setCancelReservationId={setCancelReservationId} setCancelReservationName={setCancelReservationName} />
      
      
      
      
      
      
      
      

        </AdminLayout>
  );
}
