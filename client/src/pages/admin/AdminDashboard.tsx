import { Link } from "wouter";
import {
  TrendingUp, Users, FileText, Calendar, ArrowUpRight, ArrowRight,
  Euro, Package, AlertCircle, CheckCircle2, Clock, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";

const quickActions = [
  { label: "Nuevo Presupuesto", href: "/admin/presupuestos/nuevo", icon: FileText, color: "bg-blue-500" },
  { label: "Nueva Reserva", href: "/admin/operaciones/reservas", icon: Calendar, color: "bg-emerald-500" },
  { label: "Añadir Experiencia", href: "/admin/productos/experiencias", icon: Package, color: "bg-purple-500" },
  { label: "Ver Leads", href: "/admin/presupuestos/leads", icon: Users, color: "bg-amber-500" },
];

const recentActivity = [
  { type: "lead", message: "Nuevo lead: Carlos García - Esquí en Pirineos", time: "Hace 5 min", status: "nuevo" },
  { type: "booking", message: "Reserva confirmada: BK-001 - Kayak Costa Brava", time: "Hace 1 hora", status: "confirmado" },
  { type: "quote", message: "Presupuesto aceptado: QT-045 - Multiaventura", time: "Hace 2 horas", status: "aceptado" },
  { type: "booking", message: "Actividad completada: Escalada Sierra Guadarrama", time: "Ayer", status: "completado" },
  { type: "lead", message: "Nuevo lead: Empresa TechCorp - Team Building", time: "Ayer", status: "nuevo" },
];

const statusColors: Record<string, string> = {
  nuevo: "bg-blue-100 text-blue-700",
  confirmado: "bg-emerald-100 text-emerald-700",
  aceptado: "bg-green-100 text-green-700",
  completado: "bg-gray-100 text-gray-700",
  pendiente: "bg-amber-100 text-amber-700",
};

export default function AdminDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const { data: metrics } = trpc.accounting.getDashboardMetrics.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-accent" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">Acceso Restringido</h2>
          <p className="text-muted-foreground mb-6">Debes iniciar sesión para acceder al panel de administración.</p>
          <Button asChild className="bg-gold-gradient text-white hover:opacity-90">
            <a href={getLoginUrl()}>Iniciar Sesión</a>
          </Button>
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: "Ingresos Totales",
      value: `${(metrics?.totalRevenue ?? 0).toLocaleString("es-ES")}€`,
      change: "+12.5%",
      positive: true,
      icon: Euro,
      color: "text-emerald-500",
      bg: "bg-emerald-50",
    },
    {
      label: "Reservas Activas",
      value: String(metrics?.totalBookings ?? 0),
      change: "+8.2%",
      positive: true,
      icon: Calendar,
      color: "text-blue-500",
      bg: "bg-blue-50",
    },
    {
      label: "Leads Nuevos",
      value: String(metrics?.totalLeads ?? 0),
      change: "+23.1%",
      positive: true,
      icon: Users,
      color: "text-purple-500",
      bg: "bg-purple-50",
    },
    {
      label: "Presupuestos Pendientes",
      value: String(metrics?.pendingQuotes ?? 0),
      change: "-3.4%",
      positive: false,
      icon: FileText,
      color: "text-amber-500",
      bg: "bg-amber-50",
    },
  ];

  return (
    <AdminLayout title="Dashboard">
      {/* Welcome */}
      <div className="mb-8">
        <h2 className="text-2xl font-display font-bold text-foreground">
          Bienvenido, {user?.name?.split(" ")[0] ?? "Administrador"} 👋
        </h2>
        <p className="text-muted-foreground mt-1">
          Aquí tienes un resumen de la actividad de Nayade Experiences.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-card rounded-2xl border border-border/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", stat.bg)}>
                <stat.icon className={cn("w-5 h-5", stat.color)} />
              </div>
              <div className={cn(
                "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
                stat.positive ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
              )}>
                <TrendingUp className={cn("w-3 h-3", !stat.positive && "rotate-180")} />
                {stat.change}
              </div>
            </div>
            <div className="text-2xl font-display font-bold text-foreground mb-1">{stat.value}</div>
            <div className="text-sm text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="lg:col-span-1">
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <h3 className="font-display font-semibold text-foreground mb-4">Acciones Rápidas</h3>
            <div className="space-y-2">
              {quickActions.map((action) => (
                <Link key={action.href} href={action.href}>
                  <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer group">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", action.color)}>
                      <action.icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">
                      {action.label}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto group-hover:text-accent transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Module Access */}
          <div className="bg-card rounded-2xl border border-border/50 p-5 mt-5">
            <h3 className="font-display font-semibold text-foreground mb-4">Módulos del Sistema</h3>
            <div className="space-y-2">
              {[
                { label: "Gestor CMS", href: "/admin/cms", desc: "Contenido y multimedia" },
                { label: "Productos", href: "/admin/productos/experiencias", desc: "Experiencias y categorías" },
                { label: "Presupuestos", href: "/admin/presupuestos/leads", desc: "Leads y cotizaciones" },
                { label: "Operaciones", href: "/admin/operaciones/calendario", desc: "Calendario y monitores" },
                { label: "Contabilidad", href: "/admin/contabilidad/dashboard", desc: "Informes y métricas" },
              ].map((mod) => (
                <Link key={mod.href} href={mod.href}>
                  <div className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer group">
                    <div>
                      <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">{mod.label}</p>
                      <p className="text-xs text-muted-foreground">{mod.desc}</p>
                    </div>
                    <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-accent transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <div className="bg-card rounded-2xl border border-border/50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-foreground">Actividad Reciente</h3>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                Ver todo
              </Button>
            </div>
            <div className="space-y-3">
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted/30 transition-colors">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    activity.type === "lead" ? "bg-blue-100" :
                    activity.type === "booking" ? "bg-emerald-100" : "bg-purple-100"
                  )}>
                    {activity.type === "lead" ? <Users className="w-3.5 h-3.5 text-blue-600" /> :
                     activity.type === "booking" ? <Calendar className="w-3.5 h-3.5 text-emerald-600" /> :
                     <FileText className="w-3.5 h-3.5 text-purple-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{activity.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {activity.time}
                      </span>
                      <Badge className={cn("text-xs py-0", statusColors[activity.status] ?? "bg-gray-100 text-gray-700")}>
                        {activity.status}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Today's Schedule */}
          <div className="bg-card rounded-2xl border border-border/50 p-5 mt-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-foreground">Actividades de Hoy</h3>
              <Link href="/admin/operaciones/calendario">
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  Ver calendario
                </Button>
              </Link>
            </div>
            <div className="space-y-3">
              {[
                { time: "09:00", title: "Esquí en Pirineos - Grupo 8 personas", monitor: "Juan García", status: "confirmado" },
                { time: "10:30", title: "Kayak Costa Brava - Pareja", monitor: "María López", status: "en_curso" },
                { time: "14:00", title: "Escalada Sierra - Grupo corporativo", monitor: "Pedro Martín", status: "pendiente" },
              ].map((act, i) => (
                <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-muted/30">
                  <div className="text-sm font-semibold text-accent w-12 shrink-0">{act.time}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{act.title}</p>
                    <p className="text-xs text-muted-foreground">Monitor: {act.monitor}</p>
                  </div>
                  <Badge className={cn("text-xs shrink-0", statusColors[act.status] ?? "bg-gray-100 text-gray-700")}>
                    {act.status.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
