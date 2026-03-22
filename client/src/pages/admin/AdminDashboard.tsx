import { Link } from "wouter";
import { useState, useEffect } from "react";
import {
  TrendingUp, TrendingDown, Users, FileText, Calendar, ArrowUpRight, ArrowRight,
  Euro, Package, AlertCircle, Clock, Zap, BarChart3, Receipt,
  CheckCircle2, Activity, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, isLocalAuth } from "@/const";
import { cn } from "@/lib/utils";

// ─── COUNT-UP HOOK ────────────────────────────────────────────────────────────
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

// ─── KPI CARD ─────────────────────────────────────────────────────────────────
const KPI_STYLES = {
  emerald: {
    bg: "bg-gradient-to-br from-emerald-950/90 via-emerald-900/40 to-[#080e1c]",
    border: "border-emerald-500/30",
    glow: "bg-emerald-500/15",
    icon: "text-emerald-400",
    number: "text-emerald-300",
    label: "text-emerald-300/60",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  blue: {
    bg: "bg-gradient-to-br from-blue-950/90 via-blue-900/40 to-[#080e1c]",
    border: "border-blue-500/30",
    glow: "bg-blue-500/15",
    icon: "text-blue-400",
    number: "text-blue-300",
    label: "text-blue-300/60",
    badge: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    dot: "bg-blue-400",
  },
  violet: {
    bg: "bg-gradient-to-br from-violet-950/90 via-violet-900/40 to-[#080e1c]",
    border: "border-violet-500/30",
    glow: "bg-violet-500/15",
    icon: "text-violet-400",
    number: "text-violet-300",
    label: "text-violet-300/60",
    badge: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    dot: "bg-violet-400",
  },
  amber: {
    bg: "bg-gradient-to-br from-amber-950/90 via-amber-900/40 to-[#080e1c]",
    border: "border-amber-500/30",
    glow: "bg-amber-500/15",
    icon: "text-amber-400",
    number: "text-amber-300",
    label: "text-amber-300/60",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
  },
};

function KpiCard({
  label, value, suffix = "", change, positive, icon: Icon, color, href,
}: {
  label: string; value: number; suffix?: string; change?: string;
  positive?: boolean; icon: React.ElementType; color: keyof typeof KPI_STYLES; href?: string;
}) {
  const s = KPI_STYLES[color];
  const animated = useCountUp(value);

  const inner = (
    <div className={cn(
      "group relative flex flex-col justify-between p-5 rounded-2xl border transition-all duration-300 overflow-hidden h-full",
      s.bg, s.border, href && "cursor-pointer hover:scale-[1.02] hover:brightness-110"
    )}>
      {/* Glow blob */}
      <div className={cn("absolute -top-4 -right-4 w-20 h-20 rounded-full blur-2xl opacity-40 transition-opacity duration-300 group-hover:opacity-70", s.glow)} />

      {/* Top row */}
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

      {/* Number */}
      <div className="relative z-10">
        <div className={cn("text-3xl font-black tabular-nums tracking-tight leading-none mb-1", s.number)}>
          {animated}{suffix}
        </div>
        <div className={cn("text-xs font-semibold uppercase tracking-widest", s.label)}>{label}</div>
      </div>

      {/* Bottom bar */}
      <div className={cn("absolute bottom-0 left-0 right-0 h-0.5 opacity-60", s.dot)} />
    </div>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}

// ─── QUICK ACTION CARD ────────────────────────────────────────────────────────
const ACTION_STYLES = {
  blue:    { bg: "bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20 hover:border-blue-400/60", icon: "text-blue-400", arrow: "text-blue-400/50 group-hover:text-blue-400" },
  emerald: { bg: "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-400/60", icon: "text-emerald-400", arrow: "text-emerald-400/50 group-hover:text-emerald-400" },
  violet:  { bg: "bg-violet-500/10 border-violet-500/30 hover:bg-violet-500/20 hover:border-violet-400/60", icon: "text-violet-400", arrow: "text-violet-400/50 group-hover:text-violet-400" },
  amber:   { bg: "bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400/60", icon: "text-amber-400", arrow: "text-amber-400/50 group-hover:text-amber-400" },
  orange:  { bg: "bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20 hover:border-orange-400/60", icon: "text-orange-400", arrow: "text-orange-400/50 group-hover:text-orange-400" },
  slate:   { bg: "bg-slate-500/10 border-slate-500/30 hover:bg-slate-500/20 hover:border-slate-400/60", icon: "text-slate-400", arrow: "text-slate-400/50 group-hover:text-slate-400" },
};

function ActionCard({ label, desc, href, icon: Icon, color }: {
  label: string; desc: string; href: string; icon: React.ElementType; color: keyof typeof ACTION_STYLES;
}) {
  const s = ACTION_STYLES[color];
  return (
    <Link href={href}>
      <div className={cn("group flex items-center gap-3 p-3.5 rounded-xl border transition-all duration-200 cursor-pointer", s.bg)}>
        <div className={cn("p-2 rounded-lg bg-white/5 shrink-0")}>
          <Icon className={cn("w-4 h-4", s.icon)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white/90 group-hover:text-white transition-colors truncate">{label}</p>
          <p className="text-xs text-white/40 truncate">{desc}</p>
        </div>
        <ArrowRight className={cn("w-3.5 h-3.5 shrink-0 transition-colors", s.arrow)} />
      </div>
    </Link>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const { data: metrics } = trpc.accounting.getDashboardMetrics.useQuery(undefined, {
    enabled: isAuthenticated,
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
          <button
            className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
            onClick={() => { window.location.href = getLoginUrl("/admin"); }}
          >
            Iniciar Sesión
          </button>
          <p className="mt-4 text-sm text-white/30">
            {isLocalAuth() ? "Accede con tu email y contraseña de administrador." : "Accede con tu cuenta de Manus."}
          </p>
        </div>
      </div>
    );
  }

  const firstName = user?.name?.split(" ")[0] ?? "Administrador";
  const hour = new Date().getHours();
  const greeting = hour < 13 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <AdminLayout title="Dashboard">
      {/* ── WELCOME HEADER ─────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden mb-8 p-6 border border-white/5"
        style={{ background: "linear-gradient(135deg, #0d1526 0%, #080e1c 60%, #0d1a10 100%)" }}>
        {/* Ambient glows */}
        <div className="absolute top-0 left-0 w-64 h-64 rounded-full blur-3xl opacity-20" style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-15" style={{ background: "radial-gradient(circle, #10b981 0%, transparent 70%)" }} />

        <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400/80 uppercase tracking-widest">Sistema activo</span>
            </div>
            <h1 className="text-2xl font-black text-white mb-1">
              {greeting}, {firstName} 👋
            </h1>
            <p className="text-white/40 text-sm">
              Nayade Experiences · Panel de Administración · {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}
            </p>
          </div>
          <Link href="/admin/crm">
            <button className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-sm font-semibold px-4 py-2 rounded-xl transition-all hover:border-blue-400/60">
              <Activity className="w-4 h-4" />
              Ir al CRM
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </Link>
        </div>
      </div>

      {/* ── KPI GRID ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          label="Ingresos Totales"
          value={Math.round(metrics?.totalRevenue ?? 0)}
          suffix="€"
          change="+12.5%"
          positive
          icon={Euro}
          color="emerald"
          href="/admin/contabilidad/dashboard"
        />
        <KpiCard
          label="Reservas Activas"
          value={metrics?.totalBookings ?? 0}
          change="+8.2%"
          positive
          icon={Calendar}
          color="blue"
          href="/admin/crm"
        />
        <KpiCard
          label="Leads Nuevos"
          value={metrics?.totalLeads ?? 0}
          change="+23.1%"
          positive
          icon={Users}
          color="violet"
          href="/admin/crm"
        />
        <KpiCard
          label="Presupuestos Pendientes"
          value={metrics?.pendingQuotes ?? 0}
          change="-3.4%"
          positive={false}
          icon={FileText}
          color="amber"
          href="/admin/crm"
        />
      </div>

      {/* ── MAIN GRID ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* ── LEFT COLUMN: Quick Actions + Modules ── */}
        <div className="space-y-5">

          {/* Quick Actions */}
          <div className="rounded-2xl border border-white/5 p-5" style={{ background: "#0d1526" }}>
            <div className="flex items-center gap-2 mb-4">
              <Zap className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Acciones Rápidas</h3>
            </div>
            <div className="space-y-2">
              <ActionCard label="Nuevo Presupuesto" desc="Crear propuesta para cliente" href="/admin/crm" icon={FileText} color="blue" />
              <ActionCard label="Nueva Reserva" desc="Registrar reserva confirmada" href="/admin/operaciones/reservas" icon={Calendar} color="emerald" />
              <ActionCard label="Añadir Experiencia" desc="Gestionar catálogo de productos" href="/admin/productos/experiencias" icon={Package} color="violet" />
              <ActionCard label="CRM Comercial" desc="Leads, presupuestos y facturas" href="/admin/crm" icon={Users} color="amber" />
            </div>
          </div>

          {/* System Modules */}
          <div className="rounded-2xl border border-white/5 p-5" style={{ background: "#0d1526" }}>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-black text-white uppercase tracking-widest">Módulos</h3>
            </div>
            <div className="space-y-1">
              {[
                { label: "CMS", desc: "Contenido y multimedia", href: "/admin/cms", dot: "bg-blue-400" },
                { label: "Productos", desc: "Experiencias y packs", href: "/admin/productos/experiencias", dot: "bg-violet-400" },
                { label: "CRM Comercial", desc: "Leads, presupuestos, facturas", href: "/admin/crm", dot: "bg-amber-400" },
                { label: "Operaciones", desc: "Calendario y monitores", href: "/admin/operaciones/calendario", dot: "bg-emerald-400" },
                { label: "Contabilidad", desc: "Informes y métricas", href: "/admin/contabilidad/dashboard", dot: "bg-orange-400" },
                { label: "Hotel & SPA", desc: "Reservas y servicios", href: "/admin/hotel", dot: "bg-pink-400" },
              ].map((mod) => (
                <Link key={mod.href} href={mod.href}>
                  <div className="group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
                    <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", mod.dot)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{mod.label}</p>
                      <p className="text-xs text-white/30">{mod.desc}</p>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/60 transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Activity + Schedule ── */}
        <div className="lg:col-span-2 space-y-5">

          {/* Recent Activity */}
          <div className="rounded-2xl border border-white/5 p-5" style={{ background: "#0d1526" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Actividad Reciente</h3>
              </div>
              <Link href="/admin/crm">
                <button className="text-xs text-white/30 hover:text-white/70 transition-colors flex items-center gap-1">
                  Ver todo <ArrowRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
            <div className="space-y-1">
              {[
                { type: "lead", message: "Nuevo lead: Carlos García — Kayak", time: "Hace 5 min", color: "bg-blue-500/20 border-blue-500/30", dot: "bg-blue-400", icon: Users, iconColor: "text-blue-400" },
                { type: "booking", message: "Reserva confirmada: BK-001 — Paddle Surf", time: "Hace 1 hora", color: "bg-emerald-500/20 border-emerald-500/30", dot: "bg-emerald-400", icon: CheckCircle2, iconColor: "text-emerald-400" },
                { type: "quote", message: "Presupuesto aceptado: PRE-2026-0001", time: "Hace 2 horas", color: "bg-violet-500/20 border-violet-500/30", dot: "bg-violet-400", icon: FileText, iconColor: "text-violet-400" },
                { type: "invoice", message: "Factura generada: FAC-2026-03-0001", time: "Hace 3 horas", color: "bg-amber-500/20 border-amber-500/30", dot: "bg-amber-400", icon: Receipt, iconColor: "text-amber-400" },
                { type: "lead", message: "Nuevo lead: TechCorp — Team Building", time: "Ayer", color: "bg-blue-500/20 border-blue-500/30", dot: "bg-blue-400", icon: Users, iconColor: "text-blue-400" },
              ].map((activity, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors">
                  <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center shrink-0", activity.color)}>
                    <activity.icon className={cn("w-3.5 h-3.5", activity.iconColor)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 truncate">{activity.message}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Clock className="w-3 h-3 text-white/20" />
                    <span className="text-xs text-white/30 whitespace-nowrap">{activity.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Today's Schedule */}
          <div className="rounded-2xl border border-white/5 p-5" style={{ background: "#0d1526" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-widest">Actividades de Hoy</h3>
              </div>
              <Link href="/admin/operaciones/calendario">
                <button className="text-xs text-white/30 hover:text-white/70 transition-colors flex items-center gap-1">
                  Calendario <ArrowRight className="w-3 h-3" />
                </button>
              </Link>
            </div>
            <div className="space-y-2">
              {[
                { time: "09:00", title: "Esquí en Pirineos — Grupo 8 pax", monitor: "Juan García", status: "confirmado", color: "text-emerald-400", dot: "bg-emerald-400" },
                { time: "10:30", title: "Kayak Costa Brava — Pareja", monitor: "María López", status: "en curso", color: "text-blue-400", dot: "bg-blue-400" },
                { time: "14:00", title: "Escalada Sierra — Grupo corporativo", monitor: "Pedro Martín", status: "pendiente", color: "text-amber-400", dot: "bg-amber-400" },
              ].map((act, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="text-sm font-black text-white/60 w-12 shrink-0 tabular-nums">{act.time}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/90 truncate">{act.title}</p>
                    <p className="text-xs text-white/30">Monitor: {act.monitor}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className={cn("w-1.5 h-1.5 rounded-full", act.dot)} />
                    <span className={cn("text-xs font-semibold capitalize", act.color)}>{act.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
