import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  TrendingUp, TrendingDown, Users, FileText, Calendar, ArrowUpRight, ArrowRight,
  Euro, AlertCircle, Clock, Zap, BarChart3, Banknote, ShoppingBag,
  ExternalLink, Bell, AlertTriangle, Activity, CheckCircle2, UserCheck,
  XCircle, Building2, Ticket, ShoppingCart, CreditCard, Package, Star,
  Tag, Gift, ChevronRight, RefreshCw, Loader2, CheckCircle,
} from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, isLocalAuth } from "@/const";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function fmtDec(n: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
function timeAgo(d: Date | string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora mismo";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  return `Hace ${Math.floor(hrs / 24)}d`;
}
function trendPct(current: number, previous: number) {
  if (previous === 0) return current > 0 ? "+∞%" : "—";
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}
function trendPositive(current: number, previous: number) {
  return previous === 0 ? current > 0 : current >= previous;
}
function useCountUp(target: number, duration = 900) {
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

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const KPI_STYLES = {
  emerald: { bg: "bg-gradient-to-br from-emerald-950/80 via-emerald-900/30 to-[#080e1c]", border: "border-emerald-500/30", glow: "bg-emerald-500/10", icon: "text-emerald-400", number: "text-emerald-300", label: "text-emerald-300/70", dot: "bg-emerald-400" },
  blue:    { bg: "bg-gradient-to-br from-blue-950/80 via-blue-900/30 to-[#080e1c]",       border: "border-blue-500/30",    glow: "bg-blue-500/10",    icon: "text-blue-400",    number: "text-blue-300",    label: "text-blue-300/70",    dot: "bg-blue-400" },
  violet:  { bg: "bg-gradient-to-br from-violet-950/80 via-violet-900/30 to-[#080e1c]",   border: "border-violet-500/30",  glow: "bg-violet-500/10",  icon: "text-violet-400",  number: "text-violet-300",  label: "text-violet-300/70",  dot: "bg-violet-400" },
  amber:   { bg: "bg-gradient-to-br from-amber-950/80 via-amber-900/30 to-[#080e1c]",     border: "border-amber-500/30",   glow: "bg-amber-500/10",   icon: "text-amber-400",   number: "text-amber-300",   label: "text-amber-300/70",   dot: "bg-amber-400" },
  orange:  { bg: "bg-gradient-to-br from-orange-950/80 via-orange-900/30 to-[#080e1c]",   border: "border-orange-500/30",  glow: "bg-orange-500/10",  icon: "text-orange-400",  number: "text-orange-300",  label: "text-orange-300/70",  dot: "bg-orange-400" },
  rose:    { bg: "bg-gradient-to-br from-rose-950/80 via-rose-900/30 to-[#080e1c]",       border: "border-rose-500/30",    glow: "bg-rose-500/10",    icon: "text-rose-400",    number: "text-rose-300",    label: "text-rose-300/70",    dot: "bg-rose-400" },
};

function KpiCard({ label, value, suffix = "", change, positive, subLabel, icon: Icon, color, href }: {
  label: string; value: number; suffix?: string; change?: string; positive?: boolean;
  subLabel?: string; icon: React.ElementType; color: keyof typeof KPI_STYLES; href?: string;
}) {
  const s = KPI_STYLES[color];
  const animated = useCountUp(value);
  const inner = (
    <div className={cn("group relative flex flex-col justify-between p-4 rounded-xl border transition-all duration-300 overflow-hidden h-full", s.bg, s.border, href && "cursor-pointer hover:scale-[1.02] hover:brightness-110")}>
      <div className={cn("absolute -top-3 -right-3 w-14 h-14 rounded-full blur-xl opacity-50 group-hover:opacity-80 transition-opacity", s.glow)} />
      <div className="flex items-center justify-between mb-3 relative z-10">
        <span className={cn("text-[10px] font-semibold uppercase tracking-widest", s.label)}>{label}</span>
        <div className={cn("p-1.5 rounded-lg border", s.glow, s.border)}>
          <Icon className={cn("w-3.5 h-3.5", s.icon)} />
        </div>
      </div>
      <div className="relative z-10">
        <div className={cn("text-2xl font-black tabular-nums tracking-tight leading-none mb-1", s.number)}>{animated}{suffix}</div>
        {change && (
          <div className={cn("flex items-center gap-1 text-[10px] font-semibold mt-1", positive ? "text-emerald-400" : "text-rose-400")}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change} vs mes anterior
          </div>
        )}
        {subLabel && <p className={cn("text-[10px] mt-1", s.label)}>{subLabel}</p>}
      </div>
      <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 opacity-60", s.dot)} />
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ─── Panel wrapper ─────────────────────────────────────────────────────────────
function Panel({ title, icon: Icon, iconColor, children, action, badge }: {
  title: string; icon: React.ElementType; iconColor: string;
  children: React.ReactNode; action?: React.ReactNode; badge?: number;
}) {
  return (
    <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/5">
        <h2 className="text-xs font-bold uppercase tracking-widest text-white/60 flex items-center gap-2">
          <Icon className={cn("w-3.5 h-3.5", iconColor)} />
          {title}
          {badge !== undefined && badge > 0 && (
            <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full ml-1">{badge}</span>
          )}
        </h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ─── Channel Card ─────────────────────────────────────────────────────────────
function ChannelCard({ title, icon: Icon, color, href, children, alertMsg }: {
  title: string; icon: React.ElementType; color: string; href: string;
  children: React.ReactNode; alertMsg?: string;
}) {
  return (
    <Link href={href}>
      <div className={cn(
        "rounded-xl border p-4 cursor-pointer group transition-all hover:brightness-110",
        `border-${color}-700/30 hover:border-${color}-500/50`,
        `bg-gradient-to-br from-${color}-950/60 to-[#080e1c]/80`
      )}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", `bg-${color}-500/20`)}>
              <Icon className={cn("w-4 h-4", `text-${color}-400`)} />
            </div>
            <span className="font-semibold text-white text-sm">{title}</span>
          </div>
          <ArrowRight className={cn("w-4 h-4 text-white/20 group-hover:text-white/60 transition-colors", `group-hover:text-${color}-400`)} />
        </div>
        {children}
        {alertMsg && (
          <div className={cn("mt-2 flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5", `text-${color}-400 bg-${color}-500/10`)}>
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
  const map: Record<string, string> = {
    paid:            "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    pending_payment: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    confirmed:       "bg-blue-500/15 text-blue-300 border-blue-500/30",
    cancelled:       "bg-rose-500/15 text-rose-300 border-rose-500/30",
    confirmado:      "bg-blue-500/15 text-blue-300 border-blue-500/30",
    completado:      "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    pendiente:       "bg-amber-500/15 text-amber-300 border-amber-500/30",
    incidencia:      "bg-rose-500/15 text-rose-300 border-rose-500/30",
    recibida:        "bg-amber-500/15 text-amber-300 border-amber-500/30",
    en_revision:     "bg-blue-500/15 text-blue-300 border-blue-500/30",
  };
  const labels: Record<string, string> = {
    paid: "Pagado", pending_payment: "Pend. pago", confirmed: "Conf.",
    cancelled: "Cancelado", confirmado: "Confirmado", completado: "Completado",
    pendiente: "Pendiente", incidencia: "Incidencia", recibida: "Recibida",
    en_revision: "En revisión",
  };
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap", map[status] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30")}>
      {labels[status] ?? status}
    </span>
  );
}

// ─── Activity label ──────────────────────────────────────────────────────────
function activityLabel(action: string, details: Record<string, unknown> | null): string {
  const d = details ?? {};
  const map: Record<string, string> = {
    lead_created:         "Nuevo lead recibido",
    lead_updated:         "Lead actualizado",
    converted_to_quote:   `Lead convertido en presupuesto${d.quoteNumber ? ` ${d.quoteNumber}` : ""}`,
    quote_created:        "Presupuesto creado",
    quote_sent:           "Presupuesto enviado al cliente",
    quote_sent_to_client: "Presupuesto enviado al cliente",
    quote_accepted:       "Presupuesto aceptado",
    quote_rejected:       "Presupuesto rechazado",
    quote_expired:        "Presupuesto expirado",
    payment_confirmed:    `Pago confirmado${d.invoiceId ? ` · Factura #${d.invoiceId}` : ""}`,
    payment_link_sent:    "Enlace de pago enviado",
    transfer_validated:   "Transferencia bancaria validada",
    invoice_generated:    "Factura generada",
    invoice_sent:         "Factura enviada",
    invoice_paid:         "Factura cobrada",
    invoice_cancelled:    "Factura anulada",
    reservation_created:  "Reserva creada",
    reservation_paid:     "Reserva pagada online",
    reservation_cancelled:"Reserva cancelada",
    booking_created:      "Actividad programada",
    booking_confirmed:    "Actividad confirmada",
    booking_completed:    "Actividad completada",
    // Nuevos canales
    lead_created_admin:   `Nuevo lead (admin)${d.name ? ` — ${d.name}` : ""}`,
    lead_created_from_quote: `Lead creado desde presupuesto${d.name ? ` — ${d.name}` : ""}`,
    lead_deleted:         "Lead eliminado",
    marked_lost:          "Lead marcado como perdido",
    note_added:           "Nota añadida al lead",
    auto_quote_generated: `Presupuesto automático generado${d.quoteNumber ? ` ${d.quoteNumber}` : ""}`,
    quote_created_direct: `Presupuesto directo creado${d.quoteNumber ? ` ${d.quoteNumber}` : ""}`,
    quote_updated:        "Presupuesto actualizado",
    quote_resent:         "Presupuesto reenviado",
    quote_duplicated:     "Presupuesto duplicado",
    quote_lost:           "Presupuesto marcado como perdido",
    opportunity_won:      `Oportunidad ganada${d.method ? ` (${d.method})` : ""}`,
    opportunity_won_manual: "Oportunidad ganada (manual)",
    converted_to_reservation_manual: "Convertido a reserva (manual)",
    transfer_payment_confirmed: "Pago por transferencia confirmado",
    booking_and_transaction_created: "Reserva operativa + transacción creadas",
    reav_expedient_created: "Expediente REAV creado",
    // Redsys (online)
    redsys_payment_confirmed: `Pago online confirmado${d.productName ? ` — ${d.productName}` : ""}${d.amount ? ` (${d.amount}€)` : ""}`,
    redsys_payment_failed:    `Pago online fallido${d.productName ? ` — ${d.productName}` : ""}`,
    // TPV (caja)
    tpv_sale_created:     `Venta TPV${d.ticketNumber ? ` ${d.ticketNumber}` : ""}${d.total ? ` — ${Number(d.total).toFixed(2)}€` : ""}${d.customerName && d.customerName !== "Cliente TPV" ? ` — ${d.customerName}` : ""}`,
    // Ticketing (cupones)
    coupon_converted_to_reservation: `Cupón canjeado${d.provider ? ` (${d.provider})` : ""}${d.productName ? ` — ${d.productName}` : ""}${d.customerName ? ` — ${d.customerName}` : ""}`,
    // Anulaciones
    cancellation_request_received: `Solicitud de anulación${d.fullName ? ` — ${d.fullName}` : ""}${d.reason ? ` (${d.reason})` : ""}`,
  };
  return map[action] ?? action.replace(/_/g, " ");
}

function ActivityIcon({ type }: { type: string }) {
  const cfg: Record<string, { bg: string; text: string; letter: string }> = {
    lead:        { bg: "bg-violet-500/15", text: "text-violet-400", letter: "L" },
    quote:       { bg: "bg-blue-500/15",   text: "text-blue-400",   letter: "P" },
    reservation: { bg: "bg-emerald-500/15",text: "text-emerald-400",letter: "R" },
    invoice:     { bg: "bg-amber-500/15",  text: "text-amber-400",  letter: "F" },
  };
  const c = cfg[type] ?? { bg: "bg-slate-500/15", text: "text-slate-400", letter: "·" };
  return <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0", c.bg, c.text)}>{c.letter}</span>;
}

function opStatusBadge(status: string, clientConfirmed: boolean) {
  if (!clientConfirmed) return <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-300 border-amber-500/30">Sin confirmar</span>;
  const map: Record<string, string> = {
    confirmado: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    completado: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    pendiente:  "bg-amber-500/15 text-amber-300 border-amber-500/30",
    incidencia: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  };
  const labels: Record<string, string> = { confirmado: "Confirmado", completado: "Completado", pendiente: "Pendiente", incidencia: "Incidencia" };
  return <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", map[status] ?? "bg-slate-500/15 text-slate-300")}>{labels[status] ?? status}</span>;
}

// ─── Section divider ──────────────────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full bg-gradient-to-b from-orange-400 to-blue-600" />
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
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

  const { data: ticketingStats } = trpc.ticketing.getDashboardStats.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 2 * 60 * 1000,
  });

  const { data: suppliersKpis } = trpc.settlements.kpis.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  // TPV: check if any session is open for register 1 (default)
  const { data: tpvSession } = trpc.tpv.getActiveSession.useQuery(
    { registerId: 1 },
    { enabled: isAuthenticated, staleTime: 60 * 1000 }
  );

  // ── Auth guards ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080e1c]">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-blue-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Acceso Restringido</h2>
          <p className="text-white/50 mb-6">Debes iniciar sesión para acceder al panel de administración.</p>
          <button className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-3 rounded-xl transition-colors" onClick={() => { window.location.href = getLoginUrl("/admin"); }}>
            Iniciar Sesión
          </button>
          <p className="mt-4 text-sm text-white/30">{isLocalAuth() ? "Accede con tu email y contraseña de administrador." : "Accede con tu cuenta de Manus."}</p>
        </div>
      </div>
    );
  }

  // ── Derived values ───────────────────────────────────────────────────────
  const firstName = user?.name?.split(" ")[0] ?? "Administrador";
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const kpis = overview?.kpis;
  const funnel = overview?.funnel;
  const alerts = overview?.pendingAlerts;

  const cancellacionesPendientes = cancellationsData?.kpis?.recibidas ?? 0;
  const ticketingIncidencias = ticketingStats?.incidencias ?? 0;
  const ticketingPendientes = ticketingStats?.pendientes ?? 0;
  const liquidacionesPendientes = suppliersKpis?.pendingCount ?? 0;

  const totalAlerts =
    (alerts?.transfersToValidate ?? 0) +
    (alerts?.quotesExpiringSoon ?? 0) +
    (alerts?.invoicesOverdue ?? 0) +
    cancellacionesPendientes +
    ticketingIncidencias;

  return (
    <AdminLayout title="Dashboard">
      <div className="min-h-screen bg-[#080e1c] text-white">

        {/* ── HEADER ─────────────────────────────────────────────────────── */}
        <div className="px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-widest">Sistema activo</span>
              </div>
              <h1 className="text-xl font-black text-white">{greeting}, {firstName} 👋</h1>
              <p className="text-white/40 text-xs mt-0.5">
                Náyade Experiences · {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {totalAlerts > 0 && (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-1.5">
                  <Bell className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-300 text-xs font-semibold">{totalAlerts} alerta{totalAlerts > 1 ? "s" : ""} activa{totalAlerts > 1 ? "s" : ""}</span>
                </div>
              )}
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                className="flex items-center gap-1.5 bg-white/5 hover:bg-white/8 border border-white/10 text-white/50 text-xs font-medium px-3 py-1.5 rounded-lg transition-all"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
                Actualizar
              </button>
              <Link href="/admin/crm">
                <button className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:border-blue-400/60">
                  <Activity className="w-3.5 h-3.5" /> Ir al CRM <ArrowUpRight className="w-3 h-3" />
                </button>
              </Link>
              <Link href="/" target="_blank">
                <button className="flex items-center gap-2 bg-white/5 hover:bg-white/8 border border-white/10 text-white/40 text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
                  <ExternalLink className="w-3.5 h-3.5" /> Ver web
                </button>
              </Link>
            </div>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">

          {/* ── ZONA DE ALERTAS CRÍTICAS ────────────────────────────────── */}
          {!isLoading && totalAlerts > 0 && (
            <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <span className="text-xs font-bold text-rose-300 uppercase tracking-wide">
                  {totalAlerts} elemento{totalAlerts !== 1 ? "s" : ""} requieren atención inmediata
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
                {(alerts?.transfersToValidate ?? 0) > 0 && (
                  <Link href="/admin/crm?tab=quotes">
                    <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-rose-500/15 transition-colors">
                      <Banknote className="w-4 h-4 text-rose-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-rose-300">{alerts?.transfersToValidate} transferencia{(alerts?.transfersToValidate ?? 0) > 1 ? "s" : ""} sin validar</p>
                        <p className="text-[10px] text-rose-400/60">CRM → Presupuestos</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    </div>
                  </Link>
                )}
                {(alerts?.invoicesOverdue ?? 0) > 0 && (
                  <Link href="/admin/contabilidad">
                    <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-rose-500/15 transition-colors">
                      <FileText className="w-4 h-4 text-rose-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-rose-300">{alerts?.invoicesOverdue} factura{(alerts?.invoicesOverdue ?? 0) > 1 ? "s" : ""} sin cobrar +30d</p>
                        <p className="text-[10px] text-rose-400/60">Contabilidad → Facturas</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    </div>
                  </Link>
                )}
                {cancellacionesPendientes > 0 && (
                  <Link href="/admin/operaciones/anulaciones">
                    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-amber-500/15 transition-colors">
                      <XCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-amber-300">{cancellacionesPendientes} anulación{cancellacionesPendientes > 1 ? "es" : ""} sin revisar</p>
                        <p className="text-[10px] text-amber-400/60">Operaciones → Anulaciones</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    </div>
                  </Link>
                )}
                {(alerts?.quotesExpiringSoon ?? 0) > 0 && (
                  <Link href="/admin/crm?tab=quotes">
                    <div className="flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-orange-500/15 transition-colors">
                      <Clock className="w-4 h-4 text-orange-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-orange-300">{alerts?.quotesExpiringSoon} presupuesto{(alerts?.quotesExpiringSoon ?? 0) > 1 ? "s" : ""} por vencer</p>
                        <p className="text-[10px] text-orange-400/60">Vencen en 7 días</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    </div>
                  </Link>
                )}
                {ticketingIncidencias > 0 && (
                  <Link href="/admin/marketing/cupones">
                    <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-blue-500/15 transition-colors">
                      <Ticket className="w-4 h-4 text-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-blue-300">{ticketingIncidencias} cupón{ticketingIncidencias > 1 ? "es" : ""} con incidencia</p>
                        <p className="text-[10px] text-blue-400/60">Marketing → Cupones</p>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    </div>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* ── KPI STRIP ──────────────────────────────────────────────── */}
          <div>
            <SectionLabel label="Resumen del mes" />
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <KpiCard
                label="Ingresos este mes"
                value={Math.round(kpis?.revenueThisMonth ?? 0)}
                suffix="€"
                change={kpis && kpis.revenueLastMonth > 0 ? trendPct(kpis.revenueThisMonth, kpis.revenueLastMonth) : undefined}
                positive={kpis ? trendPositive(kpis.revenueThisMonth, kpis.revenueLastMonth) : true}
                subLabel={`Total acum: ${fmt(kpis?.revenueTotal ?? 0)}`}
                icon={Euro} color="emerald" href="/admin/contabilidad"
              />
              <KpiCard
                label="Actividades (mes)"
                value={kpis?.bookingsThisMonth ?? 0}
                subLabel={`${kpis?.bookingsPending ?? 0} pend · ${kpis?.bookingsConfirmed ?? 0} conf · Hoy: ${overview?.todayBookings?.length ?? 0}`}
                icon={Calendar} color="blue" href="/admin/operaciones/reservas"
              />
              <KpiCard
                label="Leads nuevos"
                value={kpis?.leadsNew ?? 0}
                subLabel={`Total acum: ${kpis?.leadsTotal ?? 0} leads`}
                icon={Users} color="violet" href="/admin/crm?tab=leads"
              />
              <KpiCard
                label="Pres. activos"
                value={kpis?.quotesEnviados ?? 0}
                subLabel={`${fmtDec(kpis?.quotesPendingAmount ?? 0)} en cartera`}
                icon={FileText} color="amber" href="/admin/crm?tab=quotes"
              />
              <KpiCard
                label="Facturas pend."
                value={Math.round(kpis?.invoicesPendingAmount ?? 0)}
                suffix="€"
                subLabel={`${kpis?.invoicesPendingCount ?? 0} facturas sin cobrar`}
                icon={Banknote} color="rose" href="/admin/contabilidad"
              />
              <KpiCard
                label="Liquid. pend."
                value={liquidacionesPendientes}
                subLabel={`${fmtDec(suppliersKpis?.pendingAmount ?? 0)} a pagar`}
                icon={Building2} color="orange" href="/admin/proveedores"
              />
            </div>
          </div>

          {/* ── CANALES DE VENTA ────────────────────────────────────────── */}
          <div>
            <SectionLabel label="Estado por canal de venta" />
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">

              {/* CRM Comercial */}
              <ChannelCard
                title="CRM Comercial"
                icon={Users}
                color="violet"
                href="/admin/crm"
                alertMsg={(alerts?.transfersToValidate ?? 0) > 0 ? `${alerts?.transfersToValidate} transferencia${(alerts?.transfersToValidate ?? 0) > 1 ? "s" : ""} por validar` : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-violet-300">{kpis?.leadsNew ?? 0}</p>
                    <p className="text-[10px] text-white/40">Leads nuevos</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-amber-300">{kpis?.quotesEnviados ?? 0}</p>
                    <p className="text-[10px] text-white/40">Pres. activos</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center col-span-2">
                    <p className="text-base font-black text-emerald-300">{fmtDec(kpis?.quotesPendingAmount ?? 0)}</p>
                    <p className="text-[10px] text-white/40">Cartera pendiente</p>
                  </div>
                </div>
              </ChannelCard>

              {/* Reservas Online (Redsys) */}
              <ChannelCard
                title="Reservas Online"
                icon={CreditCard}
                color="blue"
                href="/admin/operaciones/reservas"
                alertMsg={(kpis?.bookingsPending ?? 0) > 0 ? `${kpis?.bookingsPending} reserva${(kpis?.bookingsPending ?? 0) > 1 ? "s" : ""} pendiente${(kpis?.bookingsPending ?? 0) > 1 ? "s" : ""} de pago` : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-emerald-300">{kpis?.reservationsPaidThisMonth ?? kpis?.bookingsConfirmed ?? 0}</p>
                    <p className="text-[10px] text-white/40">Pagadas (mes)</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-amber-300">{kpis?.bookingsPending ?? 0}</p>
                    <p className="text-[10px] text-white/40">Pendientes</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center col-span-2">
                    <p className="text-base font-black text-blue-300">{kpis?.bookingsThisMonth ?? 0} actividades</p>
                    <p className="text-[10px] text-white/40">Total este mes</p>
                  </div>
                </div>
              </ChannelCard>

              {/* TPV / Caja */}
              <ChannelCard
                title="TPV / Caja"
                icon={ShoppingCart}
                color="emerald"
                href="/admin/tpv"
              >
                <div className="space-y-2">
                  {tpvSession ? (
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse shrink-0" />
                      <span className="text-xs text-emerald-300 font-semibold">Sesión activa</span>
                      <span className="text-[10px] text-emerald-400/60 ml-auto">{timeAgo(new Date((tpvSession as { openedAt?: number }).openedAt ?? Date.now()))}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                      <span className="w-2 h-2 bg-white/20 rounded-full shrink-0" />
                      <span className="text-xs text-white/40">Sin sesión activa</span>
                    </div>
                  )}
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xs text-white/40 mb-0.5">Acceder al punto de venta</p>
                    <p className="text-sm font-bold text-emerald-400">→ Abrir TPV</p>
                  </div>
                </div>
              </ChannelCard>

              {/* Ticketing / Cupones */}
              <ChannelCard
                title="Ticketing / Cupones"
                icon={Ticket}
                color="orange"
                href="/admin/marketing/cupones"
                alertMsg={ticketingIncidencias > 0 ? `${ticketingIncidencias} cupón${ticketingIncidencias > 1 ? "es" : ""} con incidencia` : undefined}
              >
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-orange-300">{ticketingPendientes}</p>
                    <p className="text-[10px] text-white/40">Pendientes</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-emerald-300">{ticketingStats?.convertidos ?? 0}</p>
                    <p className="text-[10px] text-white/40">Convertidos</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-blue-300">{ticketingStats?.conversionRate ?? 0}%</p>
                    <p className="text-[10px] text-white/40">Conversión</p>
                  </div>
                  <div className="bg-white/5 rounded-lg p-2 text-center">
                    <p className="text-base font-black text-rose-300">{ticketingIncidencias}</p>
                    <p className="text-[10px] text-white/40">Incidencias</p>
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
                title="Actividades de hoy"
                icon={Activity}
                iconColor="text-blue-400"
                badge={todayActivities?.length}
                action={
                  <Link href="/admin/operaciones/actividades">
                    <button className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">Ver todas <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {activitiesLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-11 bg-white/5 rounded-lg animate-pulse" />)}</div>
                ) : (todayActivities?.length ?? 0) === 0 ? (
                  <div className="text-center py-6 text-white/25">
                    <Calendar className="w-7 h-7 mx-auto mb-2 opacity-40" />
                    <p className="text-xs">No hay actividades programadas para hoy</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todayActivities?.map(b => (
                      <div key={b.id} className="flex items-center gap-3 bg-white/[0.04] hover:bg-white/[0.06] rounded-lg px-3 py-2.5 transition-colors">
                        <div className="w-11 text-center shrink-0">
                          {b.monitorName ? (
                            <div className="w-7 h-7 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center mx-auto">
                              <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center mx-auto">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white truncate">{b.activityTitle}</p>
                          <p className="text-[10px] text-white/40 truncate">
                            {b.clientName} · {b.numberOfPersons} pax
                            {b.monitorName ? ` · ${b.monitorName}` : " · Sin monitor"}
                          </p>
                        </div>
                        {opStatusBadge(b.opStatus ?? "pendiente", b.clientConfirmed ?? false)}
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Próximas actividades */}
              {(overview?.upcomingBookings?.length ?? 0) > 0 && (
                <Panel
                  title="Próximas actividades (7 días)"
                  icon={Clock}
                  iconColor="text-white/40"
                  action={
                    <Link href="/admin/operaciones/reservas">
                      <button className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">Ver todas <ExternalLink className="w-3 h-3" /></button>
                    </Link>
                  }
                >
                  <div className="space-y-2">
                    {overview?.upcomingBookings?.map(b => (
                      <div key={b.id} className="flex items-center gap-3 bg-white/[0.03] rounded-lg px-3 py-2.5">
                        <div className="w-14 text-center shrink-0">
                          <p className="text-[10px] font-semibold text-white/50">{fmtDate(b.scheduledDate)}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white truncate">{b.experienceName}</p>
                          <p className="text-[10px] text-white/40 truncate">{b.clientName} · {b.numberOfPersons} pers.</p>
                        </div>
                        <StatusBadge status={b.status} />
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              {/* Anulaciones pendientes de revisión */}
              <Panel
                title="Anulaciones pendientes"
                icon={XCircle}
                iconColor="text-rose-400"
                badge={cancellacionesPendientes}
                action={
                  <Link href="/admin/operaciones/anulaciones">
                    <button className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">Gestionar <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {cancellacionesPendientes === 0 ? (
                  <div className="text-center py-4 text-white/25">
                    <CheckCircle className="w-6 h-6 mx-auto mb-1.5 text-emerald-500/40" />
                    <p className="text-xs">Sin anulaciones pendientes</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 mb-3">
                      {cancellationsData?.rows?.slice(0, 3).map((req: { id: number; fullName: string; reason: string; operationalStatus: string; createdAt: Date }) => (
                        <Link key={req.id} href="/admin/operaciones/anulaciones">
                          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] transition-colors cursor-pointer">
                            <div className="w-7 h-7 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                              <XCircle className="w-3.5 h-3.5 text-rose-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{req.fullName}</p>
                              <p className="text-[10px] text-white/40">{req.reason} · {timeAgo(req.createdAt)}</p>
                            </div>
                            <StatusBadge status={req.operationalStatus} />
                          </div>
                        </Link>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5">
                      <div className="text-center">
                        <p className="text-base font-black text-amber-300">{cancellationsData?.kpis?.recibidas ?? 0}</p>
                        <p className="text-[10px] text-white/30">Recibidas</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-black text-blue-300">{cancellationsData?.kpis?.enRevision ?? 0}</p>
                        <p className="text-[10px] text-white/30">En revisión</p>
                      </div>
                      <div className="text-center">
                        <p className="text-base font-black text-rose-300">{cancellationsData?.kpis?.incidencias ?? 0}</p>
                        <p className="text-[10px] text-white/30">Incidencias</p>
                      </div>
                    </div>
                  </>
                )}
              </Panel>

              {/* Acciones rápidas */}
              <Panel title="Acciones rápidas" icon={Zap} iconColor="text-amber-400">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Nuevo Presupuesto",   desc: "Crear propuesta para cliente",    href: "/admin/crm?tab=quotes",         icon: FileText,     bg: "bg-blue-500/8 border-blue-500/20 hover:bg-blue-500/12",       ic: "text-blue-400" },
                    { label: "Nueva Actividad",      desc: "Registrar actividad confirmada",  href: "/admin/operaciones/reservas",   icon: Calendar,     bg: "bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/12", ic: "text-emerald-400" },
                    { label: "Venta TPV",            desc: "Abrir punto de venta",            href: "/admin/tpv",                   icon: ShoppingCart, bg: "bg-green-500/8 border-green-500/20 hover:bg-green-500/12",     ic: "text-green-400" },
                    { label: "Canjear Cupón",        desc: "Gestionar cupón externo",         href: "/admin/marketing/cupones",      icon: Ticket,       bg: "bg-orange-500/8 border-orange-500/20 hover:bg-orange-500/12", ic: "text-orange-400" },
                    { label: "Añadir Experiencia",   desc: "Gestionar catálogo de productos", href: "/admin/productos/experiencias", icon: ShoppingBag,  bg: "bg-violet-500/8 border-violet-500/20 hover:bg-violet-500/12", ic: "text-violet-400" },
                    { label: "CRM Comercial",        desc: "Leads, presupuestos y facturas",  href: "/admin/crm",                   icon: Users,        bg: "bg-amber-500/8 border-amber-500/20 hover:bg-amber-500/12",    ic: "text-amber-400" },
                    { label: "Contabilidad",         desc: "Facturas y transacciones",        href: "/admin/contabilidad",          icon: Banknote,     bg: "bg-rose-500/8 border-rose-500/20 hover:bg-rose-500/12",       ic: "text-rose-400" },
                    { label: "Ver sitio web",        desc: "Abrir la web pública",            href: "/",                            icon: ExternalLink, bg: "bg-white/5 border-white/10 hover:bg-white/8",                 ic: "text-white/50" },
                  ].map(a => (
                    <Link key={a.href} href={a.href}>
                      <div className={cn("group flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer", a.bg)}>
                        <div className="p-2 rounded-lg bg-white/5 shrink-0">
                          <a.icon className={cn("w-4 h-4", a.ic)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white/90 group-hover:text-white transition-colors truncate">{a.label}</p>
                          <p className="text-[10px] text-white/35 truncate">{a.desc}</p>
                        </div>
                        <ArrowRight className="w-3 h-3 text-white/20 group-hover:text-white/50 transition-colors shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Columna derecha (1/3) */}
            <div className="space-y-4">

              {/* Embudo de ventas */}
              <Panel title="Embudo de ventas" icon={BarChart3} iconColor="text-violet-400">
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}</div>
                ) : (
                  <div className="space-y-3">
                    {[
                      { label: "Leads totales",    value: funnel?.leads ?? 0,        color: "bg-violet-500", href: "/admin/crm?tab=leads" },
                      { label: "Presupuestos",      value: funnel?.quotes ?? 0,       color: "bg-blue-500",   href: "/admin/crm?tab=quotes" },
                      { label: "Reservas pagadas",  value: funnel?.reservations ?? 0, color: "bg-emerald-500",href: "/admin/crm?tab=reservations" },
                      { label: "Facturas emitidas", value: funnel?.invoices ?? 0,     color: "bg-amber-500",  href: "/admin/crm?tab=invoices" },
                    ].map((step, i, arr) => {
                      const maxVal = arr[0].value || 1;
                      const pct = Math.round((step.value / maxVal) * 100);
                      const convRate = i > 0 && arr[i - 1].value > 0 ? Math.round((step.value / arr[i - 1].value) * 100) : null;
                      return (
                        <Link key={step.label} href={step.href}>
                          <div className="group cursor-pointer">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-white/50 group-hover:text-white/80 transition-colors">{step.label}</span>
                              <div className="flex items-center gap-2">
                                {convRate !== null && <span className="text-[10px] text-white/20">{convRate}%</span>}
                                <span className="text-xs font-bold text-white">{step.value}</span>
                              </div>
                            </div>
                            <div className="h-1.5 bg-white/8 rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all", step.color)} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2">
                  <div className="text-center bg-white/[0.03] rounded-lg p-2">
                    <p className="text-xs font-black text-emerald-300">
                      {funnel?.leads ? Math.round((funnel.reservations / funnel.leads) * 100) : 0}%
                    </p>
                    <p className="text-[10px] text-white/30">Lead→Reserva</p>
                  </div>
                  <div className="text-center bg-white/[0.03] rounded-lg p-2">
                    <p className="text-xs font-black text-blue-300">
                      {funnel?.quotes ? Math.round((funnel.reservations / funnel.quotes) * 100) : 0}%
                    </p>
                    <p className="text-[10px] text-white/30">Pres.→Reserva</p>
                  </div>
                </div>
              </Panel>

              {/* Top experiencias del mes */}
              <Panel title="Top experiencias (mes)" icon={TrendingUp} iconColor="text-emerald-400">
                {isLoading ? (
                  <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />)}</div>
                ) : (overview?.topExperiences?.length ?? 0) === 0 ? (
                  <p className="text-xs text-white/30 text-center py-4">Sin actividades este mes</p>
                ) : (
                  <div className="space-y-2">
                    {overview?.topExperiences?.map((exp, i) => (
                      <div key={exp.experienceId} className="flex items-center gap-3 bg-white/[0.03] rounded-lg px-3 py-2.5">
                        <span className={cn(
                          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0",
                          i === 0 ? "bg-yellow-500/20 text-yellow-400" : i === 1 ? "bg-slate-400/20 text-slate-300" : i === 2 ? "bg-orange-700/20 text-orange-600" : "bg-white/5 text-white/30"
                        )}>
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-white truncate">{exp.experienceName}</p>
                          <p className="text-[10px] text-white/40">{exp.count} reserva{exp.count !== 1 ? "s" : ""}</p>
                        </div>
                        <p className="text-xs font-bold text-emerald-400 shrink-0">{fmt(exp.revenue)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Proveedores y liquidaciones */}
              <Panel
                title="Liquidaciones proveedores"
                icon={Building2}
                iconColor="text-orange-400"
                badge={liquidacionesPendientes}
                action={
                  <Link href="/admin/proveedores">
                    <button className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">Ver todas <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-white/[0.03] rounded-lg p-2 text-center">
                    <p className="text-xl font-black text-orange-300">{liquidacionesPendientes}</p>
                    <p className="text-[10px] text-white/30">Pendientes abono</p>
                  </div>
                  <div className="bg-white/[0.03] rounded-lg p-2 text-center">
                    <p className="text-sm font-black text-rose-300">{fmtDec(suppliersKpis?.pendingAmount ?? 0)}</p>
                    <p className="text-[10px] text-white/30">Importe a pagar</p>
                  </div>
                </div>
                {suppliersKpis?.ranking && suppliersKpis.ranking.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-white/30 uppercase tracking-wide font-semibold mb-1.5">Top proveedores</p>
                    {suppliersKpis.ranking.slice(0, 3).map((s: { supplierId: number; name: string; gross: number }) => (
                      <div key={s.supplierId} className="flex items-center gap-2 bg-white/[0.03] rounded-lg px-2.5 py-1.5">
                        <Building2 className="w-3 h-3 text-orange-400 shrink-0" />
                        <span className="text-[10px] text-white/70 flex-1 truncate">{s.name}</span>
                        <span className="text-[10px] font-bold text-emerald-400">{fmtDec(s.gross)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {liquidacionesPendientes > 0 && (
                  <Link href="/admin/proveedores">
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/8 rounded-lg px-2.5 py-1.5 hover:bg-amber-500/12 transition-colors cursor-pointer">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {liquidacionesPendientes} liquidación{liquidacionesPendientes > 1 ? "es" : ""} pendiente{liquidacionesPendientes > 1 ? "s" : ""} de abono
                      <ChevronRight className="w-3 h-3 ml-auto" />
                    </div>
                  </Link>
                )}
              </Panel>

              {/* Actividad reciente */}
              <Panel
                title="Actividad reciente"
                icon={Activity}
                iconColor="text-white/40"
                action={
                  <Link href="/admin/crm">
                    <button className="text-[10px] text-white/30 hover:text-white/60 flex items-center gap-1 transition-colors">Ver todo <ExternalLink className="w-3 h-3" /></button>
                  </Link>
                }
              >
                {isLoading ? (
                  <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-white/5 rounded animate-pulse" />)}</div>
                ) : (overview?.recentActivity?.length ?? 0) === 0 ? (
                  <p className="text-xs text-white/30 text-center py-4">Sin actividad reciente</p>
                ) : (
                  <div className="space-y-2.5">
                    {overview?.recentActivity
                      ?.filter(a => a.action !== "lead_deleted")
                      ?.map(a => (
                      <div key={a.id} className="flex items-start gap-2.5">
                        <ActivityIcon type={a.entityType} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-white/80 leading-snug">{activityLabel(a.action, a.details)}</p>
                          {a.actorName && <p className="text-[10px] text-white/30">{a.actorName}</p>}
                        </div>
                        <span className="text-[10px] text-white/25 shrink-0 whitespace-nowrap">{timeAgo(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {/* Presupuestos en espera */}
              {(kpis?.quotesEnviados ?? 0) > 0 && (
                <Link href="/admin/crm?tab=quotes">
                  <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/8 transition-colors cursor-pointer p-3.5 flex items-center gap-3">
                    <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-blue-300">{kpis?.quotesEnviados} presupuesto{(kpis?.quotesEnviados ?? 0) > 1 ? "s" : ""} en espera de cliente</p>
                      <p className="text-[10px] text-blue-400/60">Importe: {fmt(kpis?.quotesPendingAmount ?? 0)}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-blue-400 shrink-0" />
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
