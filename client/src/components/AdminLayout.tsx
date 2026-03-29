import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, FileText, Calendar, BarChart3,
  Settings, Menu, X, LogOut, Users, Image, ChevronDown,
  Bell, Search, User, BedDouble, Sparkles, UtensilsCrossed, AlertCircle,
  UserPlus, FileCheck, ChevronRight, Receipt, Truck, Monitor, Tag, Ticket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useLocation as useWouterLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";

const navItems = [
  {
    label: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
    roles: ["admin", "agente", "monitor"],
  },
  {
    label: "CMS",
    href: "/admin/cms",
    icon: Image,
    roles: ["admin"],
    children: [
      { label: "Slideshow", href: "/admin/cms/slideshow" },
      { label: "Módulos Home", href: "/admin/cms/modulos-home" },
      { label: "Menús", href: "/admin/cms/menus" },
      { label: "Páginas", href: "/admin/cms/paginas" },
      { label: "Multimedia", href: "/admin/cms/multimedia" },
      { label: "Galería", href: "/admin/cms/galeria" },
    ],
  },
  {
    label: "Productos",
    href: "/admin/productos",
    icon: Package,
    roles: ["admin"],
    children: [
      { label: "Experiencias", href: "/admin/productos/experiencias" },
      { label: "Categorías", href: "/admin/productos/categorias" },
      { label: "Ubicaciones", href: "/admin/productos/ubicaciones" },
      { label: "Variantes", href: "/admin/productos/variantes" },
      { label: "Lego Packs", href: "/admin/productos/lego-packs" },
    ],
  },
  {
    label: "CRM",
    href: "/admin/crm",
    icon: FileText,
    roles: ["admin", "agente"],
    children: [
      { label: "Leads", href: "/admin/crm?tab=leads", key: "crm-leads" },
      { label: "Presupuestos", href: "/admin/crm?tab=quotes", key: "crm-presupuestos" },
      { label: "Reservas", href: "/admin/crm?tab=reservations", key: "crm-reservas" },
      { label: "Facturas", href: "/admin/crm?tab=invoices", key: "crm-facturas" },
      { label: "Clientes", href: "/admin/crm/clientes", key: "crm-clientes" },
      { label: "Anulaciones", href: "/admin/crm?tab=anulaciones", key: "crm-anulaciones" },
    ],
  },
  {
    label: "Operaciones",
    href: "/admin/operaciones",
    icon: Calendar,
    roles: ["admin", "agente", "monitor"],
    children: [
      { label: "Calendario", href: "/admin/operaciones/calendario" },
      { label: "Actividades del Día", href: "/admin/operaciones/actividades" },
      { label: "Órdenes del Día", href: "/admin/operaciones/ordenes" },
      { label: "Monitores", href: "/admin/operaciones/monitores" },
      { label: "Reseñas", href: "/admin/operaciones/resenas" },
    ],
  },
  {
    label: "Contabilidad",
    href: "/admin/contabilidad",
    icon: BarChart3,
    roles: ["admin"],
    children: [
      { label: "Dashboard", href: "/admin/contabilidad/dashboard" },
      { label: "Transacciones", href: "/admin/contabilidad/transacciones" },
      { label: "Informes", href: "/admin/contabilidad/informes" },
      { label: "Gastos", href: "/admin/contabilidad/gastos" },
      { label: "Recurrentes", href: "/admin/contabilidad/gastos/recurrentes" },
      { label: "Categ. gastos", href: "/admin/contabilidad/gastos/categorias" },
      { label: "Proveedores gastos", href: "/admin/contabilidad/gastos/proveedores" },
      { label: "Cuenta Resultados", href: "/admin/contabilidad/cuenta-resultados" },
    ],
  },
  {
    label: "TPV",
    href: "/admin/tpv",
    icon: Monitor,
    roles: ["admin"],
    children: [
      { label: "Terminal de venta", href: "/admin/tpv" },
      { label: "Historial de cajas", href: "/admin/tpv/cajas" },
    ],
  },
  {
    label: "Proveedores",
    href: "/admin/suppliers",
    icon: Truck,
    roles: ["admin"],
    children: [
      { label: "Gestión de proveedores", href: "/admin/suppliers" },
      { label: "Liquidaciones", href: "/admin/settlements" },
    ],
  },
  {
    label: "Fiscal REAV",
    href: "/admin/fiscal/reav",
    icon: Receipt,
    roles: ["admin"],
    children: [
      { label: "Expedientes", href: "/admin/fiscal/reav" },
    ],
  },
  {
    label: "Hotel",
    href: "/admin/hotel",
    icon: BedDouble,
    roles: ["admin"],
  },
  {
    label: "SPA",
    href: "/admin/spa",
    icon: Sparkles,
    roles: ["admin"],
  },
  {
    label: "Restaurantes",
    href: "/admin/restaurantes",
    icon: UtensilsCrossed,
    roles: ["admin", "adminrest"],
    children: [
      { label: "Reservas", href: "/admin/restaurantes/reservas" },
      { label: "Calendario Global", href: "/admin/restaurantes/calendario" },
      { label: "Configuración", href: "/admin/restaurantes/configuracion" },
    ],
  },
  {
    label: "Marketing",
    href: "/admin/marketing",
    icon: Tag,
    roles: ["admin"],
    children: [
      { label: "Cupones & Ticketing", href: "/admin/marketing/cupones" },
      { label: "Plataformas de cupones", href: "/admin/marketing/plataformas" },
      { label: "Códigos de descuento", href: "/admin/marketing/descuentos" },
    ],
  },
  {
    label: "Usuarios",
    href: "/admin/usuarios",
    icon: Users,
    roles: ["admin"],
  },
  {
    label: "Configuración",
    href: "/admin/configuracion",
    icon: Settings,
    roles: ["admin"],
    children: [
      { label: "Ajustes generales", href: "/admin/configuracion" },
      { label: "Plantillas de Email", href: "/admin/plantillas-email" },
    ],
  },
];

/** Etiqueta y color por rol */
const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:     { label: "Administrador",         color: "text-red-400" },
  agente:    { label: "Agente Comercial",       color: "text-blue-400" },
  monitor:   { label: "Monitor",               color: "text-green-400" },
  adminrest: { label: "Gestor Restaurantes",   color: "text-orange-400" },
  user:      { label: "Usuario",               color: "text-gray-400" },
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [location, navigate] = useWouterLocation();
  const { user, logout, loading, isAuthenticated } = useAuth();

  const userRole = (user as any)?.role ?? "user";
  const roleMeta = ROLE_META[userRole] ?? ROLE_META.user;

  // ── Guard: redirect adminrest a /admin/restaurantes si intenta acceder a /admin ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "adminrest" && location === "/admin") {
      navigate("/admin/restaurantes");
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  // ── Guard: bloquear acceso a rutas no permitidas ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "adminrest") {
      const isRestaurantRoute = location.startsWith("/admin/restaurantes");
      if (!isRestaurantRoute) {
        navigate("/admin/restaurantes");
      }
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  const toggleExpanded = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  };

  const isActive = (href: string) => {
    if (href === "/admin") return location === "/admin";
    return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
  };

  const filteredNav = navItems.filter((item) => item.roles.includes(userRole));

  // ── Badges de notificación en tiempo real (polling cada 60s) ──
  const { data: leadCounters } = trpc.crm.leads.counters.useQuery(undefined, {
    enabled: isAuthenticated && ["admin", "agente"].includes(userRole),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const { data: quoteCounters } = trpc.crm.quotes.counters.useQuery(undefined, {
    enabled: isAuthenticated && ["admin", "agente"].includes(userRole),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  // Leads nuevos sin gestionar + presupuestos enviados pendientes de respuesta
  const newLeads = leadCounters?.nueva ?? 0;
  const pendingQuotes = quoteCounters?.enviado ?? 0;
  const totalAlerts = newLeads + pendingQuotes;

  // ── Datos para el panel de notificaciones (solo cuando está abierto) ──
  const { data: recentLeads } = trpc.crm.leads.list.useQuery(
    { opportunityStatus: "nueva", limit: 5, offset: 0 },
    {
      enabled: notifOpen && isAuthenticated && ["admin", "agente"].includes(userRole),
      staleTime: 30_000,
    }
  );
  const { data: recentQuotes } = trpc.crm.quotes.list.useQuery(
    { status: "enviado", limit: 5, offset: 0 },
    {
      enabled: notifOpen && isAuthenticated && ["admin", "agente"].includes(userRole),
      staleTime: 30_000,
    }
  );

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  // ── Not authenticated ──
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-accent" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">Acceso Restringido</h2>
          <p className="text-muted-foreground mb-6">Debes iniciar sesión para acceder al panel de administración.</p>
          <Button
            className="bg-primary text-white hover:bg-primary/90 px-8 py-3 text-base font-semibold w-full"
            onClick={() => { window.location.href = getLoginUrl(location); }}
          >
            Iniciar Sesión
          </Button>
        </div>
      </div>
    );
  }

  // ── Role not allowed for any admin section ──
  if (!["admin", "agente", "monitor", "adminrest"].includes(userRole)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">Sin permisos</h2>
          <p className="text-muted-foreground mb-6">Tu cuenta no tiene acceso al panel de administración.</p>
          <Button variant="outline" onClick={() => navigate("/")}>Volver al inicio</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full z-40 flex flex-col transition-all duration-300",
          "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          sidebarOpen ? "w-64" : "w-16"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <Link href={userRole === "adminrest" ? "/admin/restaurantes" : "/admin"} className="flex items-center gap-2 min-w-0">
            <img
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png"
              alt="Náyade Admin"
              className={cn("object-contain rounded-full shrink-0", sidebarOpen ? "h-10 w-10" : "h-8 w-8")}
            />
            {sidebarOpen && (
              <span className="text-xs text-amber-400 tracking-widest uppercase font-display font-bold shrink-0">
                {userRole === "adminrest" ? "Restaurantes" : "Admin"}
              </span>
            )}
          </Link>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="ml-auto w-8 h-8 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors shrink-0"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          {filteredNav.map((item) => {
            const isExpanded = expandedItems.includes(item.href) || isActive(item.href);
            const active = isActive(item.href);

            return (
              <div key={item.href} className="mb-1">
                {item.children ? (
                  <>
                    <button
                      onClick={() => toggleExpanded(item.href)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      <div className="relative shrink-0">
                        <item.icon className="w-4 h-4" />
                        {/* Badge leads nuevos en item Presupuestos */}
                        {item.href === "/admin/presupuestos" && newLeads > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                            {newLeads > 99 ? "99+" : newLeads}
                          </span>
                        )}
                        {/* Badge presupuestos enviados en item Presupuestos */}
                        {item.href === "/admin/presupuestos" && pendingQuotes > 0 && newLeads === 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                            {pendingQuotes > 99 ? "99+" : pendingQuotes}
                          </span>
                        )}
                      </div>
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 text-left">{item.label}</span>
                          {/* Badges inline cuando sidebar está expandido */}
                          {item.href === "/admin/presupuestos" && newLeads > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold px-1 mr-1">
                              {newLeads > 99 ? "99+" : newLeads}
                            </span>
                          )}
                          {item.href === "/admin/presupuestos" && pendingQuotes > 0 && (
                            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 mr-1">
                              {pendingQuotes > 99 ? "99+" : pendingQuotes}
                            </span>
                          )}
                          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} />
                        </>
                      )}
                    </button>
                    {sidebarOpen && isExpanded && item.children && (
                      <div className="ml-4 mt-1 space-y-0.5">
                        {item.children.map((child) => (
                          <Link key={(child as any).key ?? child.href} href={child.href}>
                            <div className={cn(
                              "block px-3 py-2 rounded-lg text-xs font-medium transition-all",
                              (child.href.includes("?")
                              ? (location + window.location.search) === child.href || window.location.href.includes(child.href.split("?")[1])
                              : location === child.href)
                                ? "bg-sidebar-accent text-amber-400"
                                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                            )}>
                              {child.label}
                            </div>
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <Link href={item.href}>
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    )}>
                      <item.icon className="w-4 h-4 shrink-0" />
                      {sidebarOpen && <span className="flex-1">{item.label}</span>}
                    </div>
                  </Link>
                )}
              </div>
            );
          })}
        </nav>

        {/* User Profile */}
        <div className="border-t border-sidebar-border p-3 shrink-0">
          <div className={cn("flex items-center gap-3", !sidebarOpen && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-amber-400" />
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name ?? "Usuario"}</p>
                <p className={cn("text-xs font-medium capitalize", roleMeta.color)}>{roleMeta.label}</p>
              </div>
            )}
            {sidebarOpen && (
              <button
                onClick={logout}
                className="w-7 h-7 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/50 hover:text-red-400 transition-colors"
                title="Cerrar sesión"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col transition-all duration-300", sidebarOpen ? "ml-64" : "ml-16")}>
        {/* Top Bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-6 gap-4 sticky top-0 z-30">
          {title && (
            <h1 className="font-display font-semibold text-lg text-foreground">{title}</h1>
          )}
          <div className="ml-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" className="w-9 h-9">
              <Search className="w-4 h-4" />
            </Button>
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-9 h-9 relative"
                  title={totalAlerts > 0 ? `${newLeads} leads nuevos · ${pendingQuotes} presupuestos pendientes` : "Sin alertas"}
                >
                  <Bell className="w-4 h-4" />
                  {totalAlerts > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                      {totalAlerts > 99 ? "99+" : totalAlerts}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-80 p-0 bg-card border border-border shadow-xl"
                align="end"
                sideOffset={8}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-sm font-semibold text-foreground">Notificaciones</span>
                  {totalAlerts > 0 && (
                    <span className="text-xs bg-red-500 text-white rounded-full px-2 py-0.5 font-bold">
                      {totalAlerts}
                    </span>
                  )}
                </div>

                {/* Leads nuevos */}
                {newLeads > 0 && (
                  <div className="px-4 pt-3 pb-1">
                    <div className="flex items-center gap-1.5 mb-2">
                      <UserPlus className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                        Leads nuevos ({newLeads})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(recentLeads ?? []).slice(0, 5).map((lead) => (
                        <button
                          key={lead.id}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/10 transition-colors group"
                          onClick={() => { navigate("/admin/crm"); setNotifOpen(false); }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
                              {lead.name}
                            </span>
                            <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {lead.email}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Presupuestos pendientes */}
                {pendingQuotes > 0 && (
                  <div className="px-4 pt-3 pb-1">
                    <div className="flex items-center gap-1.5 mb-2">
                      <FileCheck className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
                        Presupuestos pendientes ({pendingQuotes})
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(recentQuotes ?? []).slice(0, 5).map((quote) => (
                        <button
                          key={quote.id}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/10 transition-colors group"
                          onClick={() => { navigate("/admin/crm"); setNotifOpen(false); }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-foreground truncate max-w-[180px]">
                              {quote.clientName ?? quote.title}
                            </span>
                            <span className="text-xs font-semibold text-emerald-400 shrink-0">
                              {quote.total ? `${Number(quote.total).toFixed(2)}€` : ""}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {quote.quoteNumber} · {quote.sentAt ? new Date(quote.sentAt).toLocaleDateString("es-ES") : ""}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Estado vacío */}
                {totalAlerts === 0 && (
                  <div className="px-4 py-8 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Sin notificaciones pendientes</p>
                  </div>
                )}

                {/* Footer */}
                <div className="px-4 py-2 border-t border-border">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs text-muted-foreground hover:text-foreground justify-center"
                    onClick={() => { navigate("/admin/crm"); setNotifOpen(false); }}
                  >
                    Ver todos en el CRM
                    <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {userRole !== "adminrest" && (
              <Link href="/" target="_blank">
                <Button variant="outline" size="sm" className="text-xs">
                  Ver sitio web
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
