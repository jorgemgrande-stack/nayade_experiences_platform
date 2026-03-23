import { Link } from "wouter";
import { useState, useEffect } from "react";
import {
  TrendingUp, TrendingDown, Users, FileText, Calendar, ArrowUpRight, ArrowRight,
  Euro, AlertCircle, Clock, Zap, BarChart3, Receipt,
  Activity, Banknote, ShoppingBag, ExternalLink, Bell, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, isLocalAuth } from "@/const";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(d: Date | string) {
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function timeAgo(d: Date | string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora mismo";
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days}d`;
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
  emerald: { bg: "from-emerald-950/90 via-emerald-900/40 to-[#080e1c]", border: "border-emerald-500/30", glow: "bg-emerald-500/15", icon: "text-emerald-400", number: "text-emerald-300", label: "text-emerald-300/60", badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" },
  blue:    { bg: "from-blue-950/90 via-blue-900/40 to-[#080e1c]",       border: "border-blue-500/30",    glow: "bg-blue-500/15",    icon: "text-blue-400",    number: "text-blue-300",    label: "text-blue-300/60",    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",    dot: "bg-blue-400" },
  violet:  { bg: "from-violet-950/90 via-violet-900/40 to-[#080e1c]",   border: "border-violet-500/30",  glow: "bg-violet-500/15",  icon: "text-violet-400",  number: "text-violet-300",  label: "text-violet-300/60",  badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",  dot: "bg-violet-400" },
  amber:   { bg: "from-amber-950/90 via-amber-900/40 to-[#080e1c]",     border: "border-amber-500/30",   glow: "bg-amber-500/15",   icon: "text-amber-400",   number: "text-amber-300",   label: "text-amber-300/60",   badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",   dot: "bg-amber-400" },
};

function KpiCard({ label, value, suffix = "", change, positive, subLabel, icon: Icon, color, href }: {
  label: string; value: number; suffix?: string; change?: string; positive?: boolean;
  subLabel?: string; icon: React.ElementType; color: keyof typeof KPI_STYLES; href?: string;
}) {
  const s = KPI_STYLES[color];
  const animated = useCountUp(value);
  const inner = (
    <div className={cn("group relative flex flex-col justify-between p-5 rounded-2xl border bg-gradient-to-br transition-all duration-300 overflow-hidden h-full", s.bg, s.border, href && "cursor-pointer hover:scale-[1.02] hover:brightness-110")}>
      <div className={cn("absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl opacity-40 group-hover:opacity-70 transition-opacity", s.glow)} />
      <div className="flex items-start justify-between mb-4 relative z-10">
        <div className={cn("p-2.5 rounded-xl border", s.glow, s.border)}>
          <Icon className={cn("w-5 h-5", s.icon)} />
        </div>
        {change && (
          <div className={cn("flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border", s.badge)}>
            {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {change}
          </div>
        )}
      </div>
      <div className="relative z-10">
        <div className={cn("text-3xl font-black tabular-nums tracking-tight leading-none mb-1", s.number)}>{animated}{suffix}</div>
        <div className={cn("text-xs font-semibold uppercase tracking-widest", s.label)}>{label}</div>
        {subLabel && <div className="text-xs text-white/30 mt-1">{subLabel}</div>}
      </div>
      <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 opacity-60", s.dot)} />
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ─── Booking status badge ──────────────────────────────────────────────────────
function BookingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pendiente:  "bg-amber-500/20 text-amber-300 border-amber-500/30",
    confirmado: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    en_curso:   "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    completado: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    cancelado:  "bg-rose-500/20 text-rose-300 border-rose-500/30",
  };
  const labels: Record<string, string> = { pendiente: "Pendiente", confirmado: "Confirmado", en_curso: "En curso", completado: "Completado", cancelado: "Cancelado" };
  return <span className={cn("text-xs px-2 py-0.5 rounded-full border", map[status] ?? "bg-slate-500/20 text-slate-300")}>{labels[status] ?? status}</span>;
}

// ─── Activity icon ─────────────────────────────────────────────────────────────
function ActivityIcon({ type }: { type: string }) {
  const cfg: Record<string, { bg: string; text: string; letter: string }> = {
    lead:        { bg: "bg-violet-500/20", text: "text-violet-400", letter: "L" },
    quote:       { bg: "bg-blue-500/20",   text: "text-blue-400",   letter: "P" },
    reservation: { bg: "bg-emerald-500/20",text: "text-emerald-400",letter: "R" },
    invoice:     { bg: "bg-amber-500/20",  text: "text-amber-400",  letter: "F" },
  };
  const c = cfg[type] ?? { bg: "bg-slate-500/20", text: "text-slate-400", letter: "·" };
  return <span className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0", c.bg, c.text)}>{c.letter}</span>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const { data: overview, isLoading } = trpc.accounting.getOverview.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 60_000,
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080e1c" }}>
        <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#080e1c" }}>
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

  const firstName = user?.name?.split(" ")[0] ?? "Administrador";
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const kpis = overview?.kpis;
  const funnel = overview?.funnel;
  const alerts = overview?.pendingAlerts;
  const totalAlerts = (alerts?.transfersToValidate ?? 0) + (alerts?.quotesExpiringSoon ?? 0) + (alerts?.invoicesOverdue ?? 0);

  return (
    <AdminLayout title="Dashboard">

      {/* ── WELCOME HEADER ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden mb-6 p-6 border border-white/5" style={{ background: "linear-gradient(135deg, #0d1526 0%, #080e1c 60%, #0d1a10 100%)" }}>
        <div className="absolute top-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-20" style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-15" style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)" }} />
        <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400/80 uppercase tracking-widest">Sistema activo</span>
            </div>
            <h1 className="text-2xl font-black text-white mb-1">{greeting}, {firstName} 👋</h1>
            <p className="text-white/40 text-sm">Náyade Experiences · Panel de Administración · {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <div className="flex items-center gap-2">
            {totalAlerts > 0 && (
              <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2">
                <Bell className="w-4 h-4 text-rose-400" />
                <span className="text-rose-300 text-sm font-semibold">{totalAlerts} alerta{totalAlerts > 1 ? "s" : ""}</span>
              </div>
            )}
            <Link href="/admin/crm">
              <button className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:border-blue-400/60">
                <Activity className="w-4 h-4" /> Ir al CRM <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── KPI GRID ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Ingresos este mes"
          value={Math.round(kpis?.revenueThisMonth ?? 0)}
          suffix="€"
          change={kpis && kpis.revenueLastMonth > 0 ? trendPct(kpis.revenueThisMonth, kpis.revenueLastMonth) : undefined}
          positive={kpis ? trendPositive(kpis.revenueThisMonth, kpis.revenueLastMonth) : true}
          subLabel={kpis && kpis.revenueLastMonth > 0 ? `Mes anterior: ${fmt(kpis.revenueLastMonth)}` : `Total: ${fmt(kpis?.revenueTotal ?? 0)}`}
          icon={Euro} color="emerald" href="/admin/contabilidad/dashboard"
        />
        <KpiCard
          label="Actividades este mes"
          value={kpis?.bookingsThisMonth ?? 0}
          subLabel={`${kpis?.bookingsPending ?? 0} pend. · ${kpis?.bookingsConfirmed ?? 0} conf. · Hoy: ${overview?.todayBookings?.length ?? 0}`}
          icon={Calendar} color="blue" href="/admin/operaciones/reservas"
        />
        <KpiCard
          label="Leads nuevos este mes"
          value={kpis?.leadsNew ?? 0}
          subLabel={`Total acumulado: ${kpis?.leadsTotal ?? 0} leads`}
          icon={Users} color="violet" href="/admin/crm?tab=leads"
        />
        <KpiCard
          label="Pendiente de cobro"
          value={Math.round(kpis?.invoicesPendingAmount ?? 0)}
          suffix="€"
          subLabel={`${kpis?.invoicesPendingCount ?? 0} facturas sin cobrar`}
          icon={FileText} color="amber" href="/admin/crm?tab=invoices"
        />
      </div>

      {/* ── ALERTAS URGENTES ───────────────────────────────────────────────── */}
      {!isLoading && totalAlerts > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          {(alerts?.transfersToValidate ?? 0) > 0 && (
            <Link href="/admin/crm?tab=quotes">
              <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 cursor-pointer hover:bg-amber-500/15 transition-colors">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-300">{alerts?.transfersToValidate} transferencia{alerts?.transfersToValidate! > 1 ? "s" : ""} sin validar</p>
                  <p className="text-xs text-amber-400/70">CRM → Presupuestos</p>
                </div>
                <ArrowRight className="w-4 h-4 text-amber-400 shrink-0" />
              </div>
            </Link>
          )}
          {(alerts?.quotesExpiringSoon ?? 0) > 0 && (
            <Link href="/admin/crm?tab=quotes">
              <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 cursor-pointer hover:bg-orange-500/15 transition-colors">
                <Clock className="w-5 h-5 text-orange-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-orange-300">{alerts?.quotesExpiringSoon} presupuesto{alerts?.quotesExpiringSoon! > 1 ? "s" : ""} por vencer</p>
                  <p className="text-xs text-orange-400/70">Vencen en los próximos 7 días</p>
                </div>
                <ArrowRight className="w-4 h-4 text-orange-400 shrink-0" />
              </div>
            </Link>
          )}
          {(alerts?.invoicesOverdue ?? 0) > 0 && (
            <Link href="/admin/crm?tab=invoices">
              <div className="flex items-center gap-3 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 cursor-pointer hover:bg-rose-500/15 transition-colors">
                <Banknote className="w-5 h-5 text-rose-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-rose-300">{alerts?.invoicesOverdue} factura{alerts?.invoicesOverdue! > 1 ? "s" : ""} sin cobrar +30 días</p>
                  <p className="text-xs text-rose-400/70">CRM → Facturas</p>
                </div>
                <ArrowRight className="w-4 h-4 text-rose-400 shrink-0" />
              </div>
            </Link>
          )}
        </div>
      )}

      {/* ── MAIN GRID ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Columna izquierda + centro (2/3) ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Actividades de hoy */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Actividades de hoy
                {(overview?.todayBookings?.length ?? 0) > 0 && (
                  <span className="bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs px-2 py-0.5 rounded-full">{overview?.todayBookings?.length}</span>
                )}
              </h2>
              <Link href="/admin/operaciones/reservas">
                <button className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors">Ver todas <ExternalLink className="w-3 h-3" /></button>
              </Link>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />)}</div>
              ) : (overview?.todayBookings?.length ?? 0) === 0 ? (
                <div className="text-center py-8 text-white/30">
                  <Calendar className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No hay actividades programadas para hoy</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {overview?.todayBookings?.map(b => (
                    <div key={b.id} className="flex items-center gap-3 bg-white/4 hover:bg-white/6 rounded-xl px-3 py-2.5 transition-colors">
                      <div className="w-12 text-center shrink-0">
                        <p className="text-sm font-bold text-blue-300">{fmtTime(b.scheduledDate)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">{b.experienceName}</p>
                        <p className="text-xs text-white/40 truncate">{b.clientName} · {b.numberOfPersons} pers.</p>
                      </div>
                      <BookingBadge status={b.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Próximas actividades */}
          {(overview?.upcomingBookings?.length ?? 0) > 0 && (
            <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  Próximas actividades (7 días)
                </h2>
              </div>
              <div className="p-4 space-y-2">
                {overview?.upcomingBookings?.map(b => (
                  <div key={b.id} className="flex items-center gap-3 bg-white/3 rounded-xl px-3 py-2.5">
                    <div className="w-16 text-center shrink-0">
                      <p className="text-xs font-semibold text-white/60">{fmtDate(b.scheduledDate)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{b.experienceName}</p>
                      <p className="text-xs text-white/40 truncate">{b.clientName} · {b.numberOfPersons} pers.</p>
                    </div>
                    <BookingBadge status={b.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acciones rápidas */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="px-5 py-4 border-b border-white/5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Acciones rápidas
              </h2>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2">
              {[
                { label: "Nuevo Presupuesto",   desc: "Crear propuesta para cliente",    href: "/admin/crm?tab=quotes",                icon: FileText,     color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/15" },
                { label: "Nueva Actividad",      desc: "Registrar actividad confirmada",  href: "/admin/operaciones/reservas",          icon: Calendar,     color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/15" },
                { label: "Añadir Experiencia",   desc: "Gestionar catálogo de productos", href: "/admin/productos/experiencias",        icon: ShoppingBag,  color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/15" },
                { label: "CRM Comercial",        desc: "Leads, presupuestos y facturas",  href: "/admin/crm",                           icon: Users,        color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/15" },
                { label: "Contabilidad",         desc: "Facturas y transacciones",        href: "/admin/contabilidad/facturas",         icon: Banknote,     color: "text-rose-400",   bg: "bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/15" },
                { label: "Ver sitio web",        desc: "Abrir la web pública",            href: "/",                                    icon: ExternalLink, color: "text-slate-400",  bg: "bg-slate-500/10 border-slate-500/20 hover:bg-slate-500/15" },
              ].map(a => (
                <Link key={a.href} href={a.href}>
                  <div className={cn("group flex items-center gap-3 p-3.5 rounded-xl border transition-all cursor-pointer", a.bg)}>
                    <div className="p-2 rounded-lg bg-white/5 shrink-0">
                      <a.icon className={cn("w-4 h-4", a.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors truncate">{a.label}</p>
                      <p className="text-xs text-white/40 truncate">{a.desc}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 transition-colors shrink-0" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── Columna derecha (1/3) ── */}
        <div className="space-y-5">

          {/* Embudo de ventas */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="px-5 py-4 border-b border-white/5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-violet-400" />
                Embudo de ventas
              </h2>
            </div>
            <div className="p-4 space-y-3">
              {isLoading ? (
                <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-8 bg-white/5 rounded animate-pulse" />)}</div>
              ) : (
                [
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
                          <span className="text-xs text-white/50 group-hover:text-white/80 transition-colors">{step.label}</span>
                          <div className="flex items-center gap-2">
                            {convRate !== null && <span className="text-xs text-white/25">{convRate}%</span>}
                            <span className="text-xs font-bold text-white">{step.value}</span>
                          </div>
                        </div>
                        <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all", step.color)} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Top experiencias del mes */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="px-5 py-4 border-b border-white/5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Top experiencias (mes)
              </h2>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-white/5 rounded animate-pulse" />)}</div>
              ) : (overview?.topExperiences?.length ?? 0) === 0 ? (
                <p className="text-sm text-white/30 text-center py-4">Sin actividades este mes</p>
              ) : (
                <div className="space-y-2">
                  {overview?.topExperiences?.map((exp, i) => (
                    <div key={exp.experienceId} className="flex items-center gap-3 bg-white/3 rounded-xl px-3 py-2.5">
                      <span className="text-xs font-bold text-white/25 w-4 shrink-0">#{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-white truncate">{exp.experienceName}</p>
                        <p className="text-xs text-white/40">{exp.count} reserva{exp.count !== 1 ? "s" : ""} · {fmt(exp.revenue)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actividad reciente */}
          <div className="rounded-2xl border border-white/8 overflow-hidden" style={{ background: "rgba(255,255,255,0.03)" }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-white/40" />
                Actividad reciente
              </h2>
              <Link href="/admin/crm">
                <button className="text-xs text-white/40 hover:text-white/70 flex items-center gap-1 transition-colors">Ver todo <ExternalLink className="w-3 h-3" /></button>
              </Link>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-white/5 rounded animate-pulse" />)}</div>
              ) : (overview?.recentActivity?.length ?? 0) === 0 ? (
                <p className="text-sm text-white/30 text-center py-4">Sin actividad reciente</p>
              ) : (
                <div className="space-y-2.5">
                  {overview?.recentActivity?.map(a => (
                    <div key={a.id} className="flex items-start gap-2.5">
                      <ActivityIcon type={a.entityType} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-white/80 leading-snug">{a.action}</p>
                        {a.actorName && <p className="text-xs text-white/30">{a.actorName}</p>}
                      </div>
                      <span className="text-xs text-white/25 shrink-0 whitespace-nowrap">{timeAgo(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Presupuestos pendientes de cobro */}
          {(kpis?.quotesEnviados ?? 0) > 0 && (
            <Link href="/admin/crm?tab=quotes">
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/8 transition-colors cursor-pointer p-4 flex items-center gap-3">
                <Receipt className="w-5 h-5 text-blue-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-blue-300">{kpis?.quotesEnviados} presupuesto{kpis?.quotesEnviados! > 1 ? "s" : ""} en espera</p>
                  <p className="text-xs text-blue-400/60">Importe: {fmt(kpis?.quotesPendingAmount ?? 0)}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-blue-400 shrink-0" />
              </div>
            </Link>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
