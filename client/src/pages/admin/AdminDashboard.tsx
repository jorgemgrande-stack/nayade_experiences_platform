import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Users, FileText, Calendar, ArrowUpRight, ArrowRight,
  Euro, AlertCircle, Clock, Zap, BarChart3, Banknote, ShoppingBag,
  ExternalLink, Bell, AlertTriangle, Activity, CheckCircle2, UserCheck,
  XCircle, Building2, Ticket, ShoppingCart, CreditCard, Package, Star,
  Tag, Gift, ChevronRight, RefreshCw, Loader2, CheckCircle,
  BedDouble, Sparkles, UtensilsCrossed,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { KpiCard } from "@/components/KpiCard";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, isLocalAuth } from "@/const";
import { cn } from "@/lib/utils";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { PanelLoading } from "@/components/admin/PanelStates";
import EssentialHome from "./home/EssentialHome";
import { OperationalPanelCard } from "./home/OperationalPanelCard";
import LifeHome from "./lifeNet/LifeHome";
import { prefersLifeHome } from "@shared/lifeNet";
import { AuthRequired, PanelSpinner } from "@/components/auth/AuthRequired";
import type { Formatters, Translate } from "@shared/i18n/core";
import { usePanelBrand } from "@/hooks/usePanelBrand";
import { useI18n } from "@/i18n/I18nProvider";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Formatos y textos relativos del dashboard en el idioma de la interfaz. */
function useDash() {
  const { t, format: f } = useI18n();
  const dec1 = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return {
    t,
    f,
    fmt: (n: number) => f.currency(n, "EUR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    fmtDec: (n: number) => f.currency(n, "EUR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    fmtDate: (d: Date | string) => f.date(new Date(d), { weekday: "short", day: "numeric", month: "short" }),
    timeAgo: (d: Date | string) => {
      const diff = Date.now() - new Date(d).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return t("dashboard.timeAgo.now");
      if (mins < 60) return t("dashboard.timeAgo.min", { n: mins });
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return t("dashboard.timeAgo.hours", { n: hrs });
      return t("dashboard.timeAgo.days", { n: Math.floor(hrs / 24) });
    },
    trendPct: (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? "+∞%" : "—";
      const pct = ((current - previous) / previous) * 100;
      return `${pct >= 0 ? "+" : ""}${f.number(pct, dec1)}%`;
    },
    dec1,
  };
}
function trendPositive(current: number, previous: number) {
  return previous === 0 ? current > 0 : current >= previous;
}
// KpiCard, useCountUp y KPI_STYLES extraídos a @/components/KpiCard
// para reutilizar en HRDashboard y futuros paneles RRHH.

// ─── Panel wrapper ─────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, iconColor, children, action, badge }: {
  title: string; icon: React.ElementType; iconColor: string;
  children: React.ReactNode; action?: React.ReactNode; badge?: number;
}) {
  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-card/40">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/30">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <Icon className={cn("w-3.5 h-3.5", iconColor)} />
          {title}
          {badge !== undefined && badge > 0 && (
            <span className="bg-danger text-background text-xs font-black px-1.5 py-0.5 rounded-full ml-1">{badge}</span>
          )}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Channel Card ─────────────────────────────────────────────────────────────
const CHANNEL_COLORS: Record<string, {
  border: string; bg: string; iconBg: string; iconText: string; arrowHover: string; alertCls: string;
}> = {
  violet: {
    border:     "border-primary/30 hover:border-primary/50",
    bg:         "bg-gradient-to-br from-primary/10 to-card dark:from-primary/10 dark:to-card",
    iconBg:     "bg-primary/20",
    iconText:   "text-primary ",
    arrowHover: "group-hover:text-primary",
    alertCls:   "text-primary bg-primary/10",
  },
  blue: {
    border:     "border-info/30 hover:border-info/50",
    bg:         "bg-gradient-to-br from-info/10 to-card dark:from-info/10 dark:to-card",
    iconBg:     "bg-info/20",
    iconText:   "text-info ",
    arrowHover: "group-hover:text-info",
    alertCls:   "text-info bg-info/10",
  },
  emerald: {
    border:     "border-success/30 hover:border-success/50",
    bg:         "bg-gradient-to-br from-success/10 to-card dark:from-success/10 dark:to-card",
    iconBg:     "bg-success/20",
    iconText:   "text-success ",
    arrowHover: "group-hover:text-success",
    alertCls:   "text-success bg-success/10",
  },
  orange: {
    border:     "border-warning/30 hover:border-warning/50",
    bg:         "bg-gradient-to-br from-warning/10 to-card dark:from-warning/10 dark:to-card",
    iconBg:     "bg-warning/20",
    iconText:   "text-warning ",
    arrowHover: "group-hover:text-warning",
    alertCls:   "text-warning bg-warning/10",
  },
};

function ChannelCard({ title, icon: Icon, color, href, children, alertMsg }: {
  title: string; icon: React.ElementType; color: string; href: string;
  children: React.ReactNode; alertMsg?: string;
}) {
  const c = CHANNEL_COLORS[color] ?? CHANNEL_COLORS.violet;
  return (
    <Link href={href}>
      <div className={cn(
        "rounded-xl border p-4 cursor-pointer group transition-all hover:brightness-110",
        c.border, c.bg
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", c.iconBg)}>
              <Icon className={cn("w-4 h-4", c.iconText)} />
            </div>
            <span className="font-semibold text-sm text-foreground">{title}</span>
          </div>
          <ArrowRight className={cn("w-4 h-4 text-foreground/20 group-hover:text-foreground/60 transition-colors", c.arrowHover)} />
        </div>
        {children}
        {alertMsg && (
          <div className={cn("mt-2 flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5", c.alertCls)}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {alertMsg}
          </div>
        )}
      </div>
    </Link>
  );
}

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const map: Record<string, string> = {
    paid:            "bg-success/15 text-success border-success/30",
    pending_payment: "bg-warning/15 text-warning border-warning/30",
    confirmed:       "bg-info/15 text-info border-info/30",
    cancelled:       "bg-danger/15 text-danger border-danger/30",
    confirmado:      "bg-info/15 text-info border-info/30",
    completado:      "bg-success/15 text-success border-success/30",
    pendiente:       "bg-warning/15 text-warning border-warning/30",
    incidencia:      "bg-danger/15 text-danger border-danger/30",
    recibida:        "bg-warning/15 text-warning border-warning/30",
    en_revision:     "bg-info/15 text-info border-info/30",
  };
  const labels: Record<string, string> = {
    paid: t("dashboard.status.paid"), pending_payment: t("dashboard.status.pending_payment"), confirmed: t("dashboard.status.confirmed"),
    cancelled: t("dashboard.status.cancelled"), confirmado: t("dashboard.status.confirmado"), completado: t("dashboard.status.completado"),
    pendiente: t("dashboard.status.pendiente"), incidencia: t("dashboard.status.incidencia"), recibida: t("dashboard.status.recibida"),
    en_revision: t("dashboard.status.en_revision"),
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium whitespace-nowrap", map[status] ?? "bg-muted/15 text-foreground/70 border-border")}>
      {labels[status] ?? status}
    </span>
  );
}

// ─── Activity label ──────────────────────────────────────────────────────────
const ACTIVITY_ACTIONS = new Set([
  "lead_created", "lead_updated", "converted_to_quote", "quote_created", "quote_sent", "quote_sent_to_client", "quote_accepted",
  "quote_rejected", "quote_expired", "payment_confirmed", "payment_link_sent", "transfer_validated", "invoice_generated", "invoice_sent",
  "invoice_paid", "invoice_cancelled", "reservation_created", "reservation_paid", "reservation_cancelled", "booking_created",
  "booking_confirmed", "booking_completed", "lead_created_admin", "lead_created_from_quote", "lead_deleted", "marked_lost", "note_added",
  "auto_quote_generated", "quote_created_direct", "quote_updated", "quote_resent", "quote_duplicated", "quote_lost", "opportunity_won",
  "opportunity_won_manual", "converted_to_reservation_manual", "transfer_payment_confirmed", "booking_and_transaction_created",
  "reav_expedient_created", "redsys_payment_confirmed", "redsys_payment_failed", "tpv_sale_created", "coupon_converted_to_reservation",
  "cancellation_request_received",
]);

function activityLabel(t: Translate, f: Formatters, action: string, details: Record<string, unknown> | null): string {
  if (!ACTIVITY_ACTIONS.has(action)) return action.replace(/_/g, " ");
  const d = details ?? {};
  // Los datos (nombres, números, motivos) se muestran tal cual; solo se traduce el texto fijo
  const params = {
    q: d.quoteNumber ? ` ${d.quoteNumber}` : "",
    inv: d.invoiceId ? ` · ${t("dashboard.activityInvoice", { id: String(d.invoiceId) })}` : "",
    nm: d.name ? ` — ${d.name}` : "",
    method: d.method ? ` (${d.method})` : "",
    prod: d.productName ? ` — ${d.productName}` : "",
    amt: d.amount ? ` (${f.currency(Number(d.amount))})` : "",
    tk: d.ticketNumber ? ` ${d.ticketNumber}` : "",
    tot: d.total ? ` — ${f.currency(Number(d.total))}` : "",
    cust: d.customerName && d.customerName !== "Cliente TPV" ? ` — ${d.customerName}` : "",
    prov: d.provider ? ` (${d.provider})` : "",
    fn: d.fullName ? ` — ${d.fullName}` : "",
    rs: d.reason ? ` (${d.reason})` : "",
  } as Record<string, string>;
  return t(`dashboard.activity.${action}`, params);
}

function ActivityIcon({ type }: { type: string }) {
  const cfg: Record<string, { bg: string; text: string; letter: string }> = {
    lead:        { bg: "bg-primary/15", text: "text-primary", letter: "L" },
    quote:       { bg: "bg-info/15",   text: "text-info",   letter: "P" },
    reservation: { bg: "bg-success/15",text: "text-success",letter: "R" },
    invoice:     { bg: "bg-warning/15",  text: "text-warning",  letter: "F" },
  };
  const c = cfg[type] ?? { bg: "bg-muted/15", text: "text-muted-foreground", letter: "·" };
  return <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0", c.bg, c.text)}>{c.letter}</span>;
}

function OpStatusBadge({ status, clientConfirmed }: { status: string; clientConfirmed: boolean }) {
  const { t } = useI18n();
  if (!clientConfirmed) return <span className="text-xs px-2 py-0.5 rounded-full border bg-warning/15 text-warning border-warning/30">{t("dashboard.unconfirmed")}</span>;
  const map: Record<string, string> = {
    confirmado: "bg-info/15 text-info border-info/30",
    completado: "bg-success/15 text-success border-success/30",
    pendiente:  "bg-warning/15 text-warning border-warning/30",
    incidencia: "bg-danger/15 text-danger border-danger/30",
  };
  const labels: Record<string, string> = { confirmado: t("dashboard.status.confirmado"), completado: t("dashboard.status.completado"), pendiente: t("dashboard.status.pendiente"), incidencia: t("dashboard.status.incidencia") };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", map[status] ?? "bg-muted/15 text-foreground/70")}>{labels[status] ?? status}</span>;
}

// ─── Section divider ──────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full bg-gradient-to-b from-warning to-info" />
      <span className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground/70">{label}</span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// Empresas con licencias por capacidad: inicio por tareas (EssentialHome). Modo single (Náyade) o
// empresas sin licencias por capacidad: el dashboard de siempre, sin cambios.
export default function AdminDashboard() {
  const { t } = useI18n();
  const sub = usePanelSubscription();
  // Hogar con Life Net (plan personal o solo Life Net entre sus herramientas): su inicio es «Mi día»
  if (sub.mode === "tasks" && prefersLifeHome({ planKey: sub.data?.plan?.key ?? null, capabilityState: sub.capabilityState })) return <LifeHome />;
  if (sub.mode === "tasks") return <EssentialHome />;
  // Con error, el guardián de rutas (AdminRouteGate) muestra «Reintentar»: nunca el inicio de otra empresa
  if (sub.mode === "loading" || sub.mode === "error") {
    return (
      <AdminLayout>
        <PanelLoading label={t("dashboard.loadingHome")} />
      </AdminLayout>
    );
  }
  return <LegacyDashboard />;
}

function LegacyDashboard() {
  const { t, f, fmt, fmtDec, fmtDate, timeAgo, trendPct, dec1 } = useDash();
  const brand = usePanelBrand();
  const { user, isAuthenticated, loading } = useAuth();

  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  // ── Data fetching ────────────────────────────────────────────────────────
  const { data: overview, isLoading, refetch, isFetching } = trpc.accounting.getOverview.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60_000,
  });

  const { data: todayActivities, isLoading: activitiesLoading } = trpc.operations.activities.getForDate.useQuery(
    { date: todayStr },
    { enabled: isAuthenticated, refetchInterval: 60_000 }
  );

  const { data: cancellationsData } = trpc.cancellations.listRequests.useQuery(
    { operationalStatus: "recibida", limit: 5, offset: 0 },
    { enabled: isAuthenticated, staleTime: 2 * 60 * 1000 }
  );
  const { data: anulCountersDash } = trpc.cancellations.getCounters.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 2 * 60 * 1000,
  });

  const { data: ticketingStats } = trpc.ticketing.getDashboardStats.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 2 * 60 * 1000,
  });

  const { data: suppliersKpis } = trpc.settlements.kpis.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  const { data: installmentsAlert } = trpc.crm.paymentPlans.upcoming.useQuery(
    { daysAhead: 7 },
    { enabled: isAuthenticated, staleTime: 5 * 60 * 1000 }
  );

  // TPV: check if any session is open for register 1 (default)
  const { data: tpvSession } = trpc.tpv.getActiveSession.useQuery(
    { registerId: 1 },
    { enabled: isAuthenticated, staleTime: 60 * 1000 }
  );

  // Conciliación TPV: alertas críticas
  const { data: conciliacionAlerts } = trpc.cardTerminalBatches.getCriticalAlerts.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // Gastos bancarios: alertas
  const { data: expenseStats } = trpc.bankMovements.getExpenseStats.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // KPI distorsión fiscal — alerta solo cuando hay gastos solo fiscales en el mes.
  const { data: distortion } = trpc.financial.expenses.distortionKpi.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  // ── Auth guards ──────────────────────────────────────────────────────────
  if (loading) return <PanelSpinner />;

  // Sin sesión: al inicio de sesión de la empresa (mismo aspecto que el resto del acceso), y de vuelta aquí
  if (!isAuthenticated) return <AuthRequired returnTo="/admin" />;

  // ── Derived values ───────────────────────────────────────────────────────
  const firstName = user?.name?.split(" ")[0] ?? t("dashboard.defaultName");
  const hour = new Date().getHours();
  const greeting = hour < 13 ? t("dashboard.greeting.morning") : hour < 20 ? t("dashboard.greeting.afternoon") : t("dashboard.greeting.evening");
  const kpis = overview?.kpis;
  const funnel = overview?.funnel;
  const alerts = overview?.pendingAlerts;

  const cancellacionesPendientes = anulCountersDash?.pending ?? cancellationsData?.kpis?.recibidas ?? 0;
  const ticketingIncidencias = ticketingStats?.incidencias ?? 0;
  const ticketingPendientes = ticketingStats?.pendientes ?? 0;
  const ticketingRecibidos = ticketingStats?.recibidos ?? 0;
  const liquidacionesPendientes = suppliersKpis?.pendingCount ?? 0;
  const leadsAging = overview?.todayComplex?.leadsAging ?? 0;
  const complex = overview?.todayComplex;

  const today = new Date().toISOString().split("T")[0];
  const installmentsOverdue = (installmentsAlert ?? []).filter(i =>
    i.status === "overdue" || (i.status === "pending" && i.dueDate < today)
  ).length;
  const installmentsDueToday = (installmentsAlert ?? []).filter(i =>
    i.status === "pending" && i.dueDate === today
  ).length;
  const installmentsUrgent = installmentsOverdue + installmentsDueToday;

  const tpvStaleBatches = conciliacionAlerts?.staleBatches ?? 0;
  const tpvDifferenceBatches = conciliacionAlerts?.differenceBatches ?? 0;
  const tpvStaleMovements = conciliacionAlerts?.staleIncomingMovements ?? 0;
  const tpvUnlinkedOps = conciliacionAlerts?.unlinkedOperations ?? 0;
  const expenseCandidates = expenseStats?.candidatesCount ?? 0;
  const expenseStale = expenseStats?.staleExpensesCount ?? 0;

  const totalAlerts =
    (alerts?.transfersToValidate ?? 0) +
    (alerts?.quotesExpiringSoon ?? 0) +
    (alerts?.invoicesOverdue ?? 0) +
    cancellacionesPendientes +
    (anulCountersDash?.incidencias ?? 0) +
    ticketingIncidencias +
    (ticketingRecibidos > 0 ? 1 : 0) +
    (leadsAging > 0 ? 1 : 0) +
    (installmentsUrgent > 0 ? 1 : 0) +
    (tpvStaleBatches > 0 ? 1 : 0) +
    (tpvDifferenceBatches > 0 ? 1 : 0) +
    (tpvStaleMovements > 0 ? 1 : 0) +
    (tpvUnlinkedOps > 0 ? 1 : 0) +
    (expenseCandidates > 0 ? 1 : 0) +
    (expenseStale > 0 ? 1 : 0) +
    ((distortion?.month_.count ?? 0) > 0 ? 1 : 0);

  return (
    <AdminLayout title={t("dashboard.title")}>
      <div className="min-h-screen bg-background text-foreground">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="mx-4 sm:mx-6 mt-5 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-semibold text-success dark:text-success/80 uppercase tracking-widest">{t("dashboard.systemActive")}</span>
              </div>
              <h1 className="text-2xl font-black text-foreground">{greeting}, {firstName} 👋</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                {brand.name ? `${brand.name} · ` : ""}{f.date(new Date(), { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {totalAlerts > 0 && (
                <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-1.5">
                  <Bell className="w-3.5 h-3.5 text-danger" />
                  <span className="text-danger text-xs font-semibold">{t("dashboard.alertsActive", { n: totalAlerts })}</span>
                </div>
              )}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="flex items-center gap-1.5 bg-muted/50 hover:bg-muted border border-border/60 text-muted-foreground text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
                {t("dashboard.refresh")}
              </button>
              <Link href="/admin/crm">
                <button className="flex items-center gap-2 bg-info/20 hover:bg-info/15 border border-info/40 text-info text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:border-info/60">
                  <Activity className="w-3.5 h-3.5" /> {t("dashboard.goCrm")} <ArrowUpRight className="w-3 h-3" />
                </button>
              </Link>
              <Link href="/" target="_blank">
                <button className="flex items-center gap-2 bg-muted/50 hover:bg-muted border border-border/60 text-muted-foreground text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                  <ExternalLink className="w-3.5 h-3.5" /> {t("dashboard.viewWeb")}
                </button>
              </Link>
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-5 space-y-6">

          {/* ── ZONA DE ALERTAS CRÍTICAS ────────────────────────────────── */}
          {!isLoading && totalAlerts > 0 && (
            <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-danger" />
                <span className="text-xs font-bold text-danger uppercase tracking-wide">
                  {t("dashboard.critical.title", { n: totalAlerts })}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                {(alerts?.transfersToValidate ?? 0) > 0 && (
                  <Link href="/admin/crm?tab=quotes">
                    <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-danger/15 transition-colors">
                      <Banknote className="w-4 h-4 text-danger shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-danger">{t("dashboard.critical.transfers", { n: alerts?.transfersToValidate ?? 0 })}</p>
                        <p className="text-xs text-danger/60">{t("dashboard.critical.crmQuotes")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-danger shrink-0" />
                    </div>
                  </Link>
                )}
                {(alerts?.invoicesOverdue ?? 0) > 0 && (
                  <Link href="/admin/crm?tab=invoices">
                    <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-danger/15 transition-colors">
                      <FileText className="w-4 h-4 text-danger shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-danger">{t("dashboard.critical.invoicesOverdue", { n: alerts?.invoicesOverdue ?? 0 })}</p>
                        <p className="text-xs text-danger/60">{t("dashboard.critical.crmInvoices")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-danger shrink-0" />
                    </div>
                  </Link>
                )}
                {cancellacionesPendientes > 0 && (
                  <Link href="/admin/crm?tab=anulaciones">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <XCircle className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.cancellations", { n: cancellacionesPendientes })}</p>
                        <p className="text-xs text-warning/60">
                          {anulCountersDash?.incidencias ? t("dashboard.critical.cancellationsIncidents", { n: anulCountersDash.incidencias }) : ""}{t("dashboard.critical.crmCancellations")}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {(alerts?.quotesExpiringSoon ?? 0) > 0 && (
                  <Link href="/admin/crm?tab=quotes">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <Clock className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.quotesExpiring", { n: alerts?.quotesExpiringSoon ?? 0 })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.expireIn7")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {ticketingRecibidos > 0 && (
                  <Link href="/admin/marketing/cupones">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <Ticket className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.couponsUnreviewed", { n: ticketingRecibidos })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.marketingCoupons")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {ticketingIncidencias > 0 && (
                  <Link href="/admin/marketing/cupones">
                    <div className="flex items-center gap-2 bg-info/10 border border-info/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-info/15 transition-colors">
                      <Ticket className="w-4 h-4 text-info shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-info">{t("dashboard.critical.couponsIncident", { n: ticketingIncidencias })}</p>
                        <p className="text-xs text-info/60">{t("dashboard.critical.marketingCoupons")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-info shrink-0" />
                    </div>
                  </Link>
                )}
                {leadsAging > 0 && (
                  <Link href="/admin/crm?tab=leads">
                    <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-primary/15 transition-colors">
                      <Clock className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-primary">{t("dashboard.critical.leadsToHandle", { n: leadsAging })}</p>
                        <p className="text-xs text-primary/60">{t("dashboard.critical.crmLeadsNoQuote")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                    </div>
                  </Link>
                )}
                {installmentsOverdue > 0 && (
                  <Link href="/admin/crm?tab=pagos_pendientes">
                    <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-danger/15 transition-colors">
                      <CreditCard className="w-4 h-4 text-danger shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-danger">{t("dashboard.critical.installmentsOverdue", { n: installmentsOverdue })}</p>
                        <p className="text-xs text-danger/60">{t("dashboard.critical.crmPending")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-danger shrink-0" />
                    </div>
                  </Link>
                )}
                {installmentsDueToday > 0 && installmentsOverdue === 0 && (
                  <Link href="/admin/crm?tab=pagos_pendientes">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <CreditCard className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.installmentsToday", { n: installmentsDueToday })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.crmPending")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {tpvStaleBatches > 0 && (
                  <Link href="/admin/contabilidad/remesas-tpv">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <Package className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.staleBatches", { n: tpvStaleBatches })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.accBatches")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {tpvDifferenceBatches > 0 && (
                  <Link href="/admin/contabilidad/remesas-tpv">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.differenceBatches", { n: tpvDifferenceBatches })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.accBatches")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {tpvStaleMovements > 0 && (
                  <Link href="/admin/contabilidad/movimientos-bancarios">
                    <div className="flex items-center gap-2 bg-danger/10 border border-danger/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-danger/15 transition-colors">
                      <Banknote className="w-4 h-4 text-danger shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-danger">{t("dashboard.critical.staleMovements", { n: tpvStaleMovements })}</p>
                        <p className="text-xs text-danger/60">{t("dashboard.critical.accMovements")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-danger shrink-0" />
                    </div>
                  </Link>
                )}
                {tpvUnlinkedOps > 0 && (
                  <Link href="/admin/contabilidad/operaciones-tpv">
                    <div className="flex items-center gap-2 bg-info/10 border border-info/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-info/15 transition-colors">
                      <CreditCard className="w-4 h-4 text-info shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-info">{t("dashboard.critical.unlinkedOps", { n: tpvUnlinkedOps })}</p>
                        <p className="text-xs text-info/60">{t("dashboard.critical.accOps")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-info shrink-0" />
                    </div>
                  </Link>
                )}
                {expenseCandidates > 0 && (
                  <Link href="/admin/contabilidad/gastos">
                    <div className="flex items-center gap-2 bg-primary/10 border border-primary/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-primary/15 transition-colors">
                      <Banknote className="w-4 h-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-primary">{t("dashboard.critical.expenseCandidates", { n: expenseCandidates })}</p>
                        <p className="text-xs text-primary/60">{t("dashboard.critical.accExpenses")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                    </div>
                  </Link>
                )}
                {expenseStale > 0 && (
                  <Link href="/admin/contabilidad/gastos">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">{t("dashboard.critical.expenseStale", { n: expenseStale })}</p>
                        <p className="text-xs text-warning/60">{t("dashboard.critical.accExpenses")}</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
                {distortion && distortion.month_.count > 0 && (
                  <Link href="/admin/contabilidad/gastos?treatment=tax_only">
                    <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-warning/15 transition-colors">
                      <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-warning">
                          {t("dashboard.critical.distortion", { amount: f.number(distortion.month_.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}
                          {" "}{t("dashboard.critical.distortionCount", { n: distortion.month_.count })}
                        </p>
                        <p className="text-xs text-warning/60">
                          {t("dashboard.critical.distortionYear", { amount: f.number(distortion.year_.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), pct: f.number(distortion.pctOfOperational, dec1) })}
                        </p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-warning shrink-0" />
                    </div>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Solicitudes web y convocatorias (solo administración; oculto si la empresa no tiene ninguna) */}
          <OperationalPanelCard enabled={user?.role === "admin"} />

          {/* ── KPI STRIP ──────────────────────────────────────────────── */}
          <div>
            <SectionLabel label={t("dashboard.kpi.section")} />
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                label={t("dashboard.kpi.revenue")}
                value={Math.round(kpis?.revenueThisMonth ?? 0)}
                suffix="€"
                change={kpis && kpis.revenueLastMonth > 0 ? trendPct(kpis.revenueThisMonth, kpis.revenueLastMonth) : undefined}
                positive={kpis ? trendPositive(kpis.revenueThisMonth, kpis.revenueLastMonth) : true}
                subLabel={t("dashboard.kpi.total", { amount: fmt(kpis?.revenueTotal ?? 0) })}
                icon={Euro} color="emerald" href="/admin/contabilidad"
              />
              <KpiCard
                label={t("dashboard.kpi.activities")}
                value={kpis?.bookingsThisMonth ?? 0}
                subLabel={t("dashboard.kpi.activitiesSub", { pending: kpis?.bookingsPending ?? 0, confirmed: kpis?.bookingsConfirmed ?? 0, today: overview?.todayBookings?.length ?? 0 })}
                icon={Calendar} color="blue" href="/admin/operaciones/reservas"
              />
              <KpiCard
                label={t("dashboard.kpi.leadsUnmanaged")}
                value={kpis?.leadsNew ?? 0}
                subLabel={t("dashboard.kpi.leadsTotal", { n: kpis?.leadsTotal ?? 0 })}
                icon={Users} color="violet" href="/admin/crm?tab=leads"
              />
              <KpiCard
                label={t("dashboard.kpi.quotesActive")}
                value={kpis?.quotesEnviados ?? 0}
                subLabel={t("dashboard.kpi.inPortfolio", { amount: fmtDec(kpis?.quotesPendingAmount ?? 0) })}
                icon={FileText} color="amber" href="/admin/crm?tab=quotes"
              />
              <KpiCard
                label={t("dashboard.kpi.invoicesPending")}
                value={Math.round(kpis?.invoicesPendingAmount ?? 0)}
                suffix="€"
                subLabel={t("dashboard.kpi.invoicesUnpaid", { n: kpis?.invoicesPendingCount ?? 0 })}
                icon={Banknote} color="rose" href="/admin/contabilidad"
              />
              <KpiCard
                label={t("dashboard.kpi.settlementsPending")}
                value={liquidacionesPendientes}
                subLabel={t("dashboard.kpi.toPay", { amount: fmtDec(suppliersKpis?.pendingAmount ?? 0) })}
                icon={Building2} color="orange" href="/admin/suppliers"
              />
            </div>
          </div>

          {/* ── HOY EN EL COMPLEJO ─────────────────────────────────────── */}
          <div>
            <SectionLabel label={t("dashboard.complex.section")} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

              {/* Hotel */}
              <Link href="/admin/hotel">
                <div className="group rounded-xl border border-info/30 hover:border-info/40 dark:hover:border-info/50 bg-gradient-to-br from-info/10 to-card dark:from-info/10 dark:to-card p-4 cursor-pointer transition-all hover:brightness-105">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-info/20">
                      <BedDouble className="w-4 h-4 text-info " />
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-info transition-colors" />
                  </div>
                  <p className="text-xs font-semibold text-foreground/70 mb-2">{t("dashboard.complex.hotel")}</p>
                  {isLoading ? (
                    <div className="h-7 bg-muted/50 rounded animate-pulse" />
                  ) : (complex?.hotelReservations ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground/50">{t("dashboard.complex.noReservations")}</p>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-info ">{complex?.hotelReservations}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.complex.guests", { n: complex?.hotelGuests })}</p>
                    </>
                  )}
                </div>
              </Link>

              {/* SPA */}
              <Link href="/admin/spa">
                <div className="group rounded-xl border border-primary/30 hover:border-primary/40 dark:hover:border-primary/50 bg-gradient-to-br from-primary/10 to-card dark:from-primary/10 dark:to-card p-4 cursor-pointer transition-all hover:brightness-105">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/20">
                      <Sparkles className="w-4 h-4 text-primary " />
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-xs font-semibold text-foreground/70 mb-2">{t("dashboard.complex.spa")}</p>
                  {isLoading ? (
                    <div className="h-7 bg-muted/50 rounded animate-pulse" />
                  ) : (complex?.spaBookedSlots ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground/50">{t("dashboard.complex.noAppointments")}</p>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-primary ">{complex?.spaBookedSlots}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.complex.spaPax", { n: complex?.spaPax })}</p>
                    </>
                  )}
                </div>
              </Link>

              {/* Restaurantes */}
              <Link href="/admin/restaurantes">
                <div className="group rounded-xl border border-danger/30 hover:border-danger/40 dark:hover:border-danger/50 bg-gradient-to-br from-danger/10 to-card dark:from-danger/10 dark:to-card p-4 cursor-pointer transition-all hover:brightness-105">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-danger/20">
                      <UtensilsCrossed className="w-4 h-4 text-danger " />
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-danger transition-colors" />
                  </div>
                  <p className="text-xs font-semibold text-foreground/70 mb-2">{t("dashboard.complex.restaurants")}</p>
                  {isLoading ? (
                    <div className="h-7 bg-muted/50 rounded animate-pulse" />
                  ) : (complex?.restaurantReservations ?? 0) === 0 ? (
                    <p className="text-sm text-muted-foreground/50">{t("dashboard.complex.noReservations")}</p>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-danger ">{complex?.restaurantCovers}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.complex.restaurantRes", { n: complex?.restaurantReservations })}</p>
                    </>
                  )}
                </div>
              </Link>

              {/* Leads por atender = sin presupuesto enviado y no descartados */}
              <Link href="/admin/crm?tab=leads">
                <div className={cn(
                  "group rounded-xl border p-4 cursor-pointer transition-all hover:brightness-110",
                  leadsAging > 0
                    ? "border-primary/40 dark:border-primary/50 bg-gradient-to-br from-primary/10 to-card dark:from-primary/10 dark:to-card"
                    : "border-primary/30 dark:border-primary/20 bg-gradient-to-br from-primary/10 to-card dark:from-primary/10 dark:to-card"
                )}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/20">
                      <Clock className="w-4 h-4 text-primary" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground/20 group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-xs font-semibold text-foreground/70 mb-2">{t("dashboard.complex.leadsToHandle")}</p>
                  {isLoading ? (
                    <div className="h-7 bg-muted/50 rounded animate-pulse" />
                  ) : leadsAging === 0 ? (
                    <>
                      <p className="text-2xl font-black text-success ">0</p>
                      <p className="text-xs text-success/60 mt-0.5">{t("dashboard.complex.allQuoted")}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-2xl font-black text-primary ">{leadsAging}</p>
                      <p className="text-xs text-warning/80 mt-0.5">{t("dashboard.complex.noQuoteSent")}</p>
                    </>
                  )}
                </div>
              </Link>
            </div>
          </div>

          {/* ── CANALES DE VENTA ────────────────────────────────────────── */}
          <div>
            <SectionLabel label={t("dashboard.channels.section")} />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">

              {/* CRM Comercial */}
              <ChannelCard
                title={t("dashboard.channels.crm")}
                icon={Users}
                color="violet"
                href="/admin/crm"
                alertMsg={(alerts?.transfersToValidate ?? 0) > 0 ? t("dashboard.channels.transfersToValidate", { n: alerts?.transfersToValidate ?? 0 }) : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-primary ">{kpis?.leadsNew ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.newLeads")}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-warning ">{kpis?.quotesEnviados ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.activeQuotes")}</p>
                  </div>
                  <div className="bg-foreground/[0.05] rounded-lg p-2 text-center col-span-2">
                    <p className="text-base font-black text-success ">{fmtDec(kpis?.quotesPendingAmount ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.pendingPortfolio")}</p>
                  </div>
                </div>
              </ChannelCard>

              {/* Reservas Online (Redsys) */}
              <ChannelCard
                title={t("dashboard.channels.online")}
                icon={CreditCard}
                color="blue"
                href="/admin/operaciones/reservas"
                alertMsg={(kpis?.bookingsPending ?? 0) > 0 ? t("dashboard.channels.pendingPayment", { n: kpis?.bookingsPending ?? 0 }) : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-success ">{kpis?.reservationsPaidThisMonth ?? kpis?.bookingsConfirmed ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.paidMonth")}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-warning ">{kpis?.bookingsPending ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.pending")}</p>
                  </div>
                  <div className="bg-foreground/[0.05] rounded-lg p-2 text-center col-span-2">
                    <p className="text-base font-black text-info ">{t("dashboard.channels.activitiesCount", { n: kpis?.bookingsThisMonth ?? 0 })}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.totalMonth")}</p>
                  </div>
                </div>
              </ChannelCard>

              {/* TPV / Caja */}
              <ChannelCard
                title={t("dashboard.channels.tpv")}
                icon={ShoppingCart}
                color="emerald"
                href="/admin/tpv"
              >
                <div className="space-y-2">
                  {tpvSession ? (
                    <div className="flex items-center gap-2 bg-success/10 border border-success/20 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 bg-success rounded-full animate-pulse shrink-0" />
                      <span className="text-xs text-success font-semibold">{t("dashboard.channels.sessionActive")}</span>
                      <span className="text-xs text-success/60 ml-auto">{timeAgo(new Date((tpvSession as { openedAt?: number }).openedAt ?? Date.now()))}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-muted/40 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 bg-muted-foreground/30 rounded-full shrink-0" />
                      <span className="text-xs text-muted-foreground">{t("dashboard.channels.noSession")}</span>
                    </div>
                  )}
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground mb-0.5">{t("dashboard.channels.accessPos")}</p>
                    <p className="text-sm font-bold text-success ">{t("dashboard.channels.openTpv")}</p>
                  </div>
                </div>
              </ChannelCard>

              {/* Ticketing / Cupones */}
              <ChannelCard
                title={t("dashboard.channels.ticketing")}
                icon={Ticket}
                color="orange"
                href="/admin/marketing/cupones"
                alertMsg={ticketingIncidencias > 0 ? t("dashboard.critical.couponsIncident", { n: ticketingIncidencias }) : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-warning ">{ticketingPendientes}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.pending")}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-success ">{ticketingStats?.convertidos ?? 0}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.converted")}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-info ">{ticketingStats?.conversionRate ?? 0}%</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.conversion")}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-danger ">{ticketingIncidencias}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.channels.incidents")}</p>
                  </div>
                </div>
              </ChannelCard>
            </div>
          </div>

          {/* ── MAIN GRID ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Columna izquierda + centro (2/3) */}
            <div className="lg:col-span-2 space-y-4">

              {/* Actividades de hoy */}
              <Panel
                title={t("dashboard.today.title")}
                icon={Activity}
                iconColor="text-info"
                badge={todayActivities?.length}
                action={
                  <Link href="/admin/operaciones/actividades">
                    <button className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">{t("dashboard.today.seeAll")} <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {activitiesLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-11 bg-foreground/[0.05] rounded-lg animate-pulse" />)}</div>
                ) : (todayActivities?.length ?? 0) === 0 ? (
                  <div className="text-center py-6 text-muted-foreground/50">
                    <Calendar className="w-7 h-7 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">{t("dashboard.today.none")}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayActivities?.map(b => (
                      <div key={b.id} className="flex items-center gap-3 bg-muted/40 hover:bg-muted/60 rounded-lg px-3 py-2.5 transition-colors">
                        <div className="w-11 text-center shrink-0">
                          {b.monitorName ? (
                            <div className="w-7 h-7 rounded-full bg-info/20 border border-info/40 flex items-center justify-center mx-auto">
                              <UserCheck className="w-3.5 h-3.5 text-info" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-warning/20 border border-warning/40 flex items-center justify-center mx-auto">
                              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{b.activityTitle}</p>
                          <p className="text-xs text-foreground/50 overflow-hidden text-ellipsis whitespace-nowrap">
                            {b.clientName} · {t("dashboard.today.pax", { n: b.numberOfPersons })}
                            {b.monitorName ? ` · ${b.monitorName}` : t("dashboard.today.noMonitor")}
                          </p>
                        </div>
                        <OpStatusBadge status={b.opStatus ?? "pendiente"} clientConfirmed={b.clientConfirmed ?? false} />
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Próximas actividades */}
              {(overview?.upcomingBookings?.length ?? 0) > 0 && (
                <Panel
                  title={t("dashboard.today.upcoming")}
                  icon={Clock}
                  iconColor="text-foreground/50"
                  action={
                    <Link href="/admin/operaciones/reservas">
                      <button className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">{t("dashboard.today.seeAll")} <ExternalLink className="w-3 h-3" /></button>
                    </Link>
                  }
                >
                  <div className="space-y-2">
                    {overview?.upcomingBookings?.map(b => (
                      <div key={b.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                        <div className="w-14 text-center shrink-0">
                          <p className="text-xs font-semibold text-muted-foreground">{fmtDate(b.scheduledDate)}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{b.experienceName}</p>
                          <p className="text-xs text-foreground/50 overflow-hidden text-ellipsis whitespace-nowrap">{b.clientName} · {t("dashboard.today.persons", { n: b.numberOfPersons })}</p>
                        </div>
                        <StatusBadge status={b.status} />
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Anulaciones pendientes de revisión */}
              <Panel
                title={t("dashboard.cancellations.title")}
                icon={XCircle}
                iconColor="text-danger"
                badge={cancellacionesPendientes}
                action={
                  <Link href="/admin/crm?tab=anulaciones">
                    <button className="text-xs text-foreground/40 hover:text-foreground/65 flex items-center gap-1 transition-colors">{t("dashboard.cancellations.manage")} <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {cancellacionesPendientes === 0 ? (
                  <div className="text-center py-4 text-muted-foreground/50">
                    <CheckCircle className="w-6 h-6 mx-auto mb-1.5 text-success/40" />
                    <p className="text-xs">{t("dashboard.cancellations.none")}</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 mb-3">
                      {cancellationsData?.rows?.slice(0, 3).map((req: { id: number; fullName: string; reason: string; operationalStatus: string; createdAt: Date }) => (
                        <Link key={req.id} href="/admin/crm?tab=anulaciones">
                          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer">
                            <div className="w-7 h-7 rounded-full bg-danger/15 flex items-center justify-center shrink-0">
                              <XCircle className="w-3.5 h-3.5 text-danger" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{req.fullName}</p>
                              <p className="text-xs text-muted-foreground">{req.reason} · {timeAgo(req.createdAt)}</p>
                            </div>
                            <StatusBadge status={req.operationalStatus} />
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-foreground/[0.08]">
                      <div className="text-center">
                        <p className="text-base font-black text-warning">{cancellationsData?.kpis?.recibidas ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{t("dashboard.cancellations.received")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-black text-info ">{cancellationsData?.kpis?.enRevision ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{t("dashboard.cancellations.inReview")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-black text-danger ">{cancellationsData?.kpis?.incidencias ?? 0}</p>
                        <p className="text-xs text-muted-foreground">{t("dashboard.cancellations.incidents")}</p>
                      </div>
                    </div>
                  </>
                )}
              </Panel>

              {/* Acciones rápidas */}
              <Panel title={t("dashboard.quick.title")} icon={Zap} iconColor="text-warning">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: t("dashboard.quick.newQuote"),   desc: t("dashboard.quick.newQuoteDesc"),    href: "/admin/crm?tab=quotes",         icon: FileText,     bg: "bg-info/8 border-info/20 hover:bg-info/12",       ic: "text-info" },
                    { label: t("dashboard.quick.newActivity"),      desc: t("dashboard.quick.newActivityDesc"),  href: "/admin/operaciones/reservas",   icon: Calendar,     bg: "bg-success/8 border-success/20 hover:bg-success/12", ic: "text-success" },
                    { label: t("dashboard.quick.tpvSale"),            desc: t("dashboard.quick.tpvSaleDesc"),            href: "/admin/tpv",                   icon: ShoppingCart, bg: "bg-success/8 border-success/20 hover:bg-success/12",     ic: "text-success" },
                    { label: t("dashboard.quick.redeem"),        desc: t("dashboard.quick.redeemDesc"),         href: "/admin/marketing/cupones",      icon: Ticket,       bg: "bg-warning/8 border-warning/20 hover:bg-warning/12", ic: "text-warning" },
                    { label: t("dashboard.quick.addExperience"),   desc: t("dashboard.quick.addExperienceDesc"), href: "/admin/productos/experiencias", icon: ShoppingBag,  bg: "bg-primary/8 border-primary/20 hover:bg-primary/12", ic: "text-primary" },
                    { label: t("dashboard.quick.crm"),        desc: t("dashboard.quick.crmDesc"),  href: "/admin/crm",                   icon: Users,        bg: "bg-warning/8 border-warning/20 hover:bg-warning/12",    ic: "text-warning" },
                    { label: t("dashboard.quick.accounting"),         desc: t("dashboard.quick.accountingDesc"),        href: "/admin/contabilidad",          icon: Banknote,     bg: "bg-danger/8 border-danger/20 hover:bg-danger/12",       ic: "text-danger" },
                    { label: t("dashboard.quick.viewSite"),        desc: t("dashboard.quick.viewSiteDesc"),            href: "/",                            icon: ExternalLink, bg: "bg-muted/50 border-border/50 hover:bg-muted",                 ic: "text-muted-foreground" },
                  ].map(a => (
                    <Link key={a.href} href={a.href}>
                      <div className={cn("group flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer", a.bg)}>
                        <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                          <a.icon className={cn("w-4 h-4", a.ic)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-foreground/90 group-hover:text-foreground transition-colors overflow-hidden text-ellipsis whitespace-nowrap">{a.label}</p>
                          <p className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">{a.desc}</p>
                        </div>
                        <ArrowRight className="w-3 h-3 text-foreground/20 group-hover:text-foreground/50 transition-colors shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Columna derecha (1/3) */}
            <div className="space-y-4">

              {/* Embudo de ventas */}
              <Panel title={t("dashboard.funnel.title")} icon={BarChart3} iconColor="text-primary">
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-8 bg-muted/40 rounded animate-pulse" />)}</div>
                ) : (
                  <div className="space-y-3">
                    {[
                      { label: t("dashboard.funnel.leads"),    value: funnel?.leads ?? 0,        color: "bg-primary", href: "/admin/crm?tab=leads" },
                      { label: t("dashboard.funnel.quotes"),      value: funnel?.quotes ?? 0,       color: "bg-info",   href: "/admin/crm?tab=quotes" },
                      { label: t("dashboard.funnel.reservations"),  value: funnel?.reservations ?? 0, color: "bg-success",href: "/admin/crm?tab=reservations" },
                      { label: t("dashboard.funnel.invoices"), value: funnel?.invoices ?? 0,     color: "bg-warning",  href: "/admin/crm?tab=invoices" },
                    ].map((step, i, arr) => {
                      const maxVal = arr[0].value || 1;
                      const pct = Math.round((step.value / maxVal) * 100);
                      const convRate = i > 0 && arr[i - 1].value > 0 ? Math.round((step.value / arr[i - 1].value) * 100) : null;
                      return (
                        <Link key={step.label} href={step.href}>
                          <div className="group cursor-pointer">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{step.label}</span>
                              <div className="flex items-center gap-2">
                                {convRate !== null && <span className="text-xs text-muted-foreground/50">{convRate}%</span>}
                                <span className="text-xs font-bold text-foreground">{step.value}</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all", step.color)} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-border/30 grid grid-cols-2 gap-2">
                  <div className="text-center bg-muted/30 rounded-lg p-2">
                    <p className="text-xs font-black text-success">
                      {funnel?.leads ? Math.round((funnel.reservations / funnel.leads) * 100) : 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.funnel.leadToRes")}</p>
                  </div>
                  <div className="text-center bg-muted/30 rounded-lg p-2">
                    <p className="text-xs font-black text-info">
                      {funnel?.quotes ? Math.round((funnel.reservations / funnel.quotes) * 100) : 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.funnel.quoteToRes")}</p>
                  </div>
                </div>
              </Panel>

              {/* Top experiencias del mes */}
              <Panel title={t("dashboard.top.title")} icon={TrendingUp} iconColor="text-success">
                {isLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-foreground/[0.05] rounded animate-pulse" />)}</div>
                ) : (overview?.topExperiences?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground/50 text-center py-4">{t("dashboard.top.none")}</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.topExperiences?.map((exp, i) => (
                      <div key={exp.experienceId} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2.5">
                        <span className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center text-xs font-black shrink-0",
                          i === 0 ? "bg-warning/20 text-warning " : i === 1 ? "bg-muted/20 text-muted-foreground dark:text-foreground/70" : i === 2 ? "bg-warning/20 text-warning" : "bg-muted/50 text-muted-foreground"
                        )}>
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground overflow-hidden text-ellipsis whitespace-nowrap">{exp.experienceName}</p>
                          <p className="text-xs text-muted-foreground">{t("dashboard.top.bookings", { n: exp.count })}</p>
                        </div>
                        <p className="text-xs font-bold text-success shrink-0">{fmt(exp.revenue)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Proveedores y liquidaciones */}
              <Panel
                title={t("dashboard.suppliers.title")}
                icon={Building2}
                iconColor="text-warning"
                badge={liquidacionesPendientes}
                action={
                  <Link href="/admin/suppliers">
                    <button className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">{t("dashboard.today.seeAll")} <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-foreground/[0.03] rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-warning ">{liquidacionesPendientes}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.suppliers.pendingPay")}</p>
                  </div>
                  <div className="bg-foreground/[0.03] rounded-lg p-2 text-center">
                    <p className="text-sm font-black text-danger">{fmtDec(suppliersKpis?.pendingAmount ?? 0)}</p>
                    <p className="text-xs text-muted-foreground">{t("dashboard.suppliers.amountToPay")}</p>
                  </div>
                </div>
                {suppliersKpis?.ranking && suppliersKpis.ranking.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1.5">{t("dashboard.suppliers.top")}</p>
                    {suppliersKpis.ranking.slice(0, 3).map((s: { supplierId: number; name: string; gross: number }) => (
                      <div key={s.supplierId} className="flex items-center gap-2 bg-muted/30 rounded-lg px-2.5 py-1.5">
                        <Building2 className="w-3 h-3 text-warning shrink-0" />
                        <span className="text-xs text-foreground/70 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{s.name}</span>
                        <span className="text-xs font-bold text-success">{fmtDec(s.gross)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {liquidacionesPendientes > 0 && (
                  <Link href="/admin/suppliers">
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-warning bg-warning/8 rounded-lg px-2.5 py-1.5 hover:bg-warning/12 transition-colors cursor-pointer">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {t("dashboard.suppliers.pendingNote", { n: liquidacionesPendientes })}
                      <ChevronRight className="w-3 h-3 ml-auto" />
                    </div>
                  </Link>
                )}
              </Panel>

              {/* Actividad reciente */}
              <Panel
                title={t("dashboard.recent.title")}
                icon={Activity}
                iconColor="text-muted-foreground"
                action={
                  <Link href="/admin/crm">
                    <button className="text-xs text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors">{t("dashboard.recent.seeAll")} <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-muted/40 rounded animate-pulse" />)}</div>
                ) : (overview?.recentActivity?.length ?? 0) === 0 ? (
                  <p className="text-xs text-muted-foreground/50 text-center py-4">{t("dashboard.recent.none")}</p>
                ) : (
                  <div className="space-y-2.5">
                    {overview?.recentActivity
                      ?.filter(a => a.action !== "lead_deleted")
                      ?.map(a => (
                      <div key={a.id} className="flex items-start gap-2.5">
                        <ActivityIcon type={a.entityType} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-foreground/80 leading-snug">{activityLabel(t, f, a.action, a.details)}</p>
                          {a.actorName && <p className="text-xs text-muted-foreground">{a.actorName}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground/60 shrink-0 whitespace-nowrap">{timeAgo(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Presupuestos en espera */}
              {(kpis?.quotesEnviados ?? 0) > 0 && (
                <Link href="/admin/crm?tab=quotes">
                  <div className="rounded-xl border border-info/20 bg-info/5 hover:bg-info/8 transition-colors cursor-pointer p-3.5 flex items-center gap-3">
                    <FileText className="w-4 h-4 text-info shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-info">{t("dashboard.waiting.title", { n: kpis?.quotesEnviados ?? 0 })}</p>
                      <p className="text-xs text-info/60">{t("dashboard.waiting.amount", { amount: fmt(kpis?.quotesPendingAmount ?? 0) })}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-info shrink-0" />
                  </div>
                </Link>
              )}
            </div>
          </div>

        </div>
      </div>
    </AdminLayout>
  );
}
