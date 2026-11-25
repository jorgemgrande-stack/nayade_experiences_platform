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
import { BarChart3, Users, FileText, CalendarCheck, Calendar, Search, Plus, Send, CheckCircle, XCircle, Clock, Star, AlertTriangle, Filter, Banknote, Receipt, CreditCard, ExternalLink, FilePlus, Gift, AlertCircle, Archive, X, ChevronDown, ChevronUp, Download } from "lucide-react";
import { MetricCard } from "@/components/admin/PanelVisual";
import { SalesFamilyShell, SummaryStrip, ToolbarRow, type SummaryStripItem, type ToolbarChip } from "@/components/admin/SalesFamilyShell";
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

function fmtAmount(n: number, format: ReturnType<typeof useI18n>["format"]): string {
  if (n === 0) return "";
  return format.currency(n, "EUR", { maximumFractionDigits: 0 });
}

/** Las etiquetas traducidas de canal llevan emoji; aquí ya hay icono del sistema, así que se omite sin tocar las traducciones. */
const noEmoji = (label: string) => label.replace(new RegExp("^[\\p{Extended_Pictographic}\\uFE0F\\u200D\\s]+", "u"), "");

type CounterColor = "blue" | "amber" | "green" | "red" | "slate" | "orange" | "indigo" | "violet" | "purple";
const COUNTER_TONE: Record<CounterColor, "brand" | "info" | "success" | "warning" | "danger" | "neutral"> = {
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
  color?: CounterColor;
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

  // ─── Familia Ventas: cabecera única, franja de resumen y barra de herramientas integradas ───
  const toggleStatus = (status: string) => setFilterStatus((cur) => (cur === status ? "all" : status));
  const moneyShort = (v: number | string | null | undefined) => format.currency(Number(v) || 0, "EUR", { maximumFractionDigits: 0 });
  const leadStatusLabel: Record<string, string> = { nueva: t("crmLeads.nueva"), enviada: t("crmLeads.enviada"), ganada: t("crmLeads.ganada"), perdida: t("crmLeads.perdida") };
  const quoteStatusLabel: Record<string, string> = {
    borrador: t("crmQuotes.borrador"), enviado: t("crmQuotes.enviado"), visualizado: t("crmQuotes.visualizado"), convertido_carrito: t("crmQuotes.pagoIniciado"),
    pago_fallido: t("crmQuotes.pagoFallido"), aceptado: t("crmQuotes.aceptado"), rechazado: t("crmQuotes.rechazado"), expirado: t("crmQuotes.expirado"), perdido: t("crmQuotes.perdido"),
  };
  const statusLabels = tab === "leads" ? leadStatusLabel : quoteStatusLabel;
  const sourceLabel = leadSourceFilter === "web"
    ? t("crmDashboard.solicitudesWeb")
    : typeof leadSourceFilter === "number" ? ((leadSourcesData ?? []) as any[]).find((s) => s.id === leadSourceFilter)?.name ?? String(leadSourceFilter) : "";
  const filterChips: ToolbarChip[] = [
    ...(filterStatus !== "all" ? [{ id: "estado", label: `${t("crmOpps.estado")}: ${statusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus("all") }] : []),
    ...(tab === "leads" && leadSourceFilter !== "all" ? [{ id: "origen", label: `${t("crmOpps.origen")}: ${sourceLabel}`, onRemove: () => setLeadSourceFilter("all") }] : []),
    ...(search.trim() ? [{ id: "busqueda", label: t("crmOpps.busqueda", { text: search.trim() }), onRemove: () => setSearch("") }] : []),
  ];
  const clearAllFilters = () => { setFilterStatus("all"); setSearch(""); if (tab === "leads") setLeadSourceFilter("all"); };
  const activeTotal = tab === "leads" ? leads.leadsData?.total : quotes.quotesData?.total;
  const leadsConversion = leadCounters?.total ? Math.round(((leadCounters.ganada ?? 0) / leadCounters.total) * 100) : 0;
  const withAmount = (text: string, amount: number | string | null | undefined) => (Number(amount) > 0 ? `${text} · ${moneyShort(amount)}` : text);
  const statusOptions = tab === "leads" ? ["nueva", "enviada", "ganada", "perdida"] : ["borrador", "enviado", "visualizado", "convertido_carrito", "pago_fallido", "aceptado", "rechazado", "expirado", "perdido"];
  const resMoney = (v: number | string | null | undefined) => format.currency(Number(v) || 0, "EUR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stripItems: SummaryStripItem[] = tab === "leads" ? [
    { key: "nueva", label: t("crmOpps.leadsNuevas"), value: leadCounters?.nueva ?? 0, detail: (leadCounters?.sinLeer ?? 0) > 0 ? t("crmOpps.leadsSinLeer", { count: leadCounters?.sinLeer ?? 0 }) : undefined, primary: true, tone: "info", active: filterStatus === "nueva", onClick: () => toggleStatus("nueva") },
    { key: "enviada", label: t("crmOpps.leadsSeguimiento"), value: leadCounters?.enviada ?? 0, detail: Number(leadCounters?.valorEnviada) > 0 ? moneyShort(leadCounters?.valorEnviada) : undefined, tone: "warning", active: filterStatus === "enviada", onClick: () => toggleStatus("enviada") },
    { key: "ganada", label: t("crmOpps.leadsGanadas"), value: leadCounters?.ganada ?? 0, detail: `${leadsConversion}%`, tone: "success", active: filterStatus === "ganada", onClick: () => toggleStatus("ganada") },
    { key: "perdida", label: t("crmOpps.leadsPerdidas"), value: leadCounters?.perdida ?? 0, tone: "danger", active: filterStatus === "perdida", onClick: () => toggleStatus("perdida") },
  ] : tab === "quotes" ? [
    { key: "enviado", label: t("crmOpps.quotesPendiente"), value: moneyShort(quoteCounters?.importeEnviado), detail: quoteCounters?.enviado ?? 0, primary: true, tone: "brand", active: filterStatus === "enviado", onClick: () => toggleStatus("enviado") },
    { key: "borrador", label: t("crmOpps.quotesBorradores"), value: quoteCounters?.borrador ?? 0, detail: Number(quoteCounters?.importeBorrador) > 0 ? moneyShort(quoteCounters?.importeBorrador) : undefined, tone: "neutral", active: filterStatus === "borrador", onClick: () => toggleStatus("borrador") },
    { key: "aceptado", label: t("crmOpps.quotesAceptados"), value: quoteCounters?.ganado ?? 0, detail: Number(quoteCounters?.importeTotal) > 0 ? moneyShort(quoteCounters?.importeTotal) : undefined, tone: "success", active: filterStatus === "aceptado", onClick: () => toggleStatus("aceptado") },
    ...((quoteCounters?.pagoFallido ?? 0) > 0 ? [{ key: "pago_fallido", label: t("crmOpps.quotesPagoFallido"), value: quoteCounters?.pagoFallido ?? 0, detail: Number(quoteCounters?.importePagoFallido) > 0 ? moneyShort(quoteCounters?.importePagoFallido) : undefined, tone: "danger" as const, active: filterStatus === "pago_fallido", onClick: () => toggleStatus("pago_fallido") }] : []),
  ] : tab === "reservations" ? [
    { key: "cobrado", label: t("crmShared.cobrado"), value: resMoney(resCounters?.ingresos), detail: `${Number(resCounters?.confirmadas ?? 0) + Number(resCounters?.pendientePago ?? 0) + Number(resCounters?.canceladas ?? 0)} ${voc.ordersLower}`, primary: true, tone: "brand", active: false, onClick: () => setFilterStatus("all") },
    { key: "paid", label: t("crmReservations.pagada"), value: Number(resCounters?.confirmadas ?? 0), detail: Number(resCounters?.importeConfirmadas ?? 0) > 0 ? resMoney(resCounters?.importeConfirmadas) : undefined, tone: "success", active: filterStatus === "paid", onClick: () => toggleStatus("paid") },
    { key: "pending_payment", label: t("crmReservations.pendientePago"), value: Number(resCounters?.pendientePago ?? 0), detail: Number(resCounters?.importePendientePago ?? 0) > 0 ? resMoney(resCounters?.importePendientePago) : undefined, tone: "warning", active: filterStatus === "pending_payment", onClick: () => toggleStatus("pending_payment") },
    { key: "cancelled", label: t("crmReservations.cancelada"), value: Number(resCounters?.canceladas ?? 0), tone: "danger", active: filterStatus === "cancelled", onClick: () => toggleStatus("cancelled") },
  ] : [];
  const actionNode = tab === "leads" ? (
    <Button onClick={() => setShowNewLeadModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {voc.newLead}</Button>
  ) : tab === "quotes" ? (
    <Button onClick={() => setShowDirectQuoteModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {voc.licensed ? t("crmDashboard.nuevoPresupuesto") : t("crmDashboard.nuevoPresupuesto2")}</Button>
  ) : tab === "reservations" ? (
    <Button onClick={() => setShowNewReservationModal(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {voc.newOrder}</Button>
  ) : tab === "anulaciones" ? (
    <Button onClick={() => window.open("/solicitar-anulacion", "_blank")}><ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmCancellations.verFormularioPublico")}</Button>
  ) : tab === "invoices" ? (
    <>
      <Button variant="outline" onClick={() => invoices.setGestoriaExportOpen(true)}><Download className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmInvoices.exportarParaLaGestoria")}</Button>
      <Button onClick={() => setNewInvoiceOpen(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmInvoices.nuevaFactura")}</Button>
    </>
  ) : undefined;
  const kpiLabel = kpisExpanded ? t("salesShell.lessIndicators") : t("salesShell.moreIndicators");
  const kpiToggle = (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0" onClick={toggleKpis} aria-expanded={kpisExpanded} aria-label={kpiLabel} title={kpiLabel}>
      <BarChart3 className="h-4 w-4" aria-hidden="true" />
    </Button>
  );
  const resStatusLabels: Record<string, string> = { paid: t("crmReservations.pagada"), pending_payment: t("crmReservations.pendientePago"), cancelled: t("crmReservations.cancelada") };
  const channelNames: Record<string, string> = {
    TPV_FISICO: t("crmReservations.tpv"), VENTA_DELEGADA: t("crmReservations.delegada"), ONLINE_DIRECTO: t("crmReservations.online"), ONLINE_ASISTIDO: t("crmReservations.asistido"),
    TELEFONO: t("crmReservations.tel"), EMAIL: t("crmReservations.email3"), PARTNER: t("crmReservations.partner"), TICKETING: t("crmReservations.ticketing"),
    MANUAL: t("crmDashboard.manualOtro"), API: t("crmDashboard.api"), coupon: t("crmDashboard.cuponOrigen"),
  };
  const resChips: ToolbarChip[] = [
    ...(filterStatus !== "all" ? [{ id: "status", label: `${t("crmShared.filtroEstado")}: ${resStatusLabels[filterStatus] ?? filterStatus}`, onRemove: () => setFilterStatus("all") }] : []),
    ...(resChannelFilter !== "all" ? [{ id: "channel", label: `${t("crmShared.filtroCanal")}: ${channelNames[resChannelFilter] ?? resChannelFilter}`, onRemove: () => setResChannelFilter("all") }] : []),
    ...(search.trim() ? [{ id: "search", label: `“${search.trim()}”`, onRemove: () => setSearch("") }] : []),
  ];
  const clearResFilters = () => { setFilterStatus("all"); setResChannelFilter("all"); setSearch(""); };
  const statusSelect = (
    <Select value={filterStatus} onValueChange={setFilterStatus}>
      <SelectTrigger className="h-9 w-full bg-card text-sm sm:w-44" aria-label={t("crmOpps.estado")}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("crmOpps.todosLosEstados")}</SelectItem>
        {(tab === "reservations" ? ["paid", "pending_payment", "cancelled"] : statusOptions).map((s) => <SelectItem key={s} value={s}>{(tab === "reservations" ? resStatusLabels : statusLabels)[s]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const sourceSelect = (
    <Select value={String(leadSourceFilter)} onValueChange={v => setLeadSourceFilter(v === "all" || v === "web" ? v : Number(v))}>
      <SelectTrigger className="h-9 w-full bg-card text-sm sm:w-44" aria-label={t("crmOpps.origen")}><SelectValue placeholder={t("crmDashboard.origen")} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("crmDashboard.todosLosOrigenes")}</SelectItem>
        <SelectItem value="web">{t("crmDashboard.solicitudesWeb")}</SelectItem>
        {(leadSourcesData ?? []).map((src: any) => (
          <SelectItem key={src.id} value={String(src.id)}><span style={{ color: src.color ?? undefined }}>{src.name}</span></SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  const channelSelect = (
    <Select value={resChannelFilter} onValueChange={setResChannelFilter}>
              <SelectTrigger className="h-9 w-full bg-card text-sm sm:w-44" aria-label={t("crmDashboard.canal")}>
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
  );
  const toolbarNode = tab === "reservations" ? (
    <ToolbarRow
      search={{ value: search, onChange: setSearch, placeholder: t("crmEmpty.search.orders", { ordersLower: voc.ordersLower }) }}
      filters={<>{statusSelect}{channelSelect}</>}
      chips={resChips}
      onClear={clearResFilters}
      summary={res.resData ? `${res.resData.total} ${res.ordersWord}` : undefined}
    />
  ) : tab === "leads" || tab === "quotes" ? (
    <ToolbarRow
      search={{ value: search, onChange: setSearch, placeholder: tab === "leads" ? t("crmEmpty.search.leads", { leadsLower: voc.leadsLower }) : t("crmEmpty.search.quotes") }}
      filters={<>{statusSelect}{tab === "leads" && sourceSelect}</>}
      chips={filterChips}
      onClear={clearAllFilters}
      summary={filterChips.length > 0 && activeTotal !== undefined ? t("crmOpps.resultados", { count: activeTotal }) : undefined}
    />
  ) : null;

  return (
    <AdminLayout title={voc.crmTitle}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <SalesFamilyShell active={tab} onSelect={handleTabChange} action={actionNode} headerExtra={stripItems.length > 0 ? undefined : kpiToggle}>
        {stripItems.length > 0 && <SummaryStrip items={stripItems} trailing={kpiToggle} />}


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
            <div className="rounded-xl border border-danger/30 bg-danger/8 p-3 space-y-1.5">
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

        {/* Top KPI strip — dos grupos diferenciados */}
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${kpisExpanded ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className="py-1 space-y-4">

          {/* Grupo 1: Pipeline de Oportunidades */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 rounded-full bg-info" />
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
              <div className="w-1 h-4 rounded-full bg-primary" />
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
              <div className="w-1 h-4 rounded-full bg-success" />
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
              <div className="w-1 h-4 rounded-full bg-danger" />
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
                  <div className="w-1 h-4 rounded-full bg-primary/70" />
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
                            <td className="px-3 py-2 text-right font-semibold text-foreground">{format.number((inst.amountCents / 100), { minimumFractionDigits: 2 })} €</td>
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
              <div className="w-1 h-4 rounded-full bg-muted-foreground" />
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
          <div className="pb-1">
            <div className="bg-foreground/[0.03] border border-foreground/[0.10] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded-full bg-success" />
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
                  className="absolute left-0 top-0 h-full bg-success rounded-full transition-all duration-1000"
                  style={{ width: `${leadCounters?.total ? ((leadCounters.ganada ?? 0) / leadCounters.total) * 100 : 0}%` }}
                />
                {/* Enviadas (apiladas) */}
                <div
                  className="absolute top-0 h-full bg-warning/60 rounded-full transition-all duration-1000"
                  style={{
                    left: `${leadCounters?.total ? ((leadCounters.ganada ?? 0) / leadCounters.total) * 100 : 0}%`,
                    width: `${leadCounters?.total ? ((leadCounters.enviada ?? 0) / leadCounters.total) * 100 : 0}%`,
                  }}
                />
                {/* Nuevas (apiladas) */}
                <div
                  className="absolute top-0 h-full bg-info/40 rounded-full transition-all duration-1000"
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
          <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 flex flex-col gap-2">
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
                          <span key={r.id} className="inline-flex items-center text-xs bg-info/10 text-info rounded overflow-hidden">
                            <button
                              onClick={() => setGenInvoiceResId(r.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-info/20 transition-colors cursor-pointer"
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
                              className="px-1.5 py-1 hover:bg-info/20 text-info hover:text-info transition-colors border-l border-info/40"
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
                          <span key={r.id} className="inline-flex items-center text-xs bg-warning/10 text-warning rounded overflow-hidden">
                            <button
                              onClick={() => setGenInvoiceResId(r.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 hover:bg-warning/20 transition-colors cursor-pointer"
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
                              className="px-1.5 py-1 hover:bg-warning/20 text-warning hover:text-warning transition-colors border-l border-warning/40"
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
                      className="inline-flex items-center gap-1.5 text-xs bg-warning/10 hover:bg-warning/20 text-warning rounded px-2 py-1 transition-colors cursor-pointer"
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
          <div className="rounded-xl border border-info/30 bg-info/8 px-4 py-3 flex flex-col gap-1.5">
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

        {toolbarNode}
        <div>
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
        </SalesFamilyShell>
        <div className="order-last px-4 sm:px-6 pb-6">
          <WorkplaceLocks place="crm" className="mt-3" />
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
