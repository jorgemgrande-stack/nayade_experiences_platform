import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, FileText, Calendar, BarChart3,
  Settings, Menu, X, LogOut, Users, Image, ChevronDown,
  Bell, Search, User, BedDouble, Sparkles, UtensilsCrossed, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useLocation as useWouterLocation } from "wouter";
import { getLoginUrl } from "@/const";

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
    ],
  },
  {
    label: "Productos",
    href: "/admin/productos",
    icon: Package,
    roles: ["admin"],
    children: [
      { label: "Experiencias", href: "/admin/productos/experiencias" },
      { label: "Packs", href: "/admin/productos/packs" },
      { label: "Categorías", href: "/admin/productos/categorias" },
      { label: "Ubicaciones", href: "/admin/productos/ubicaciones" },
      { label: "Variantes", href: "/admin/productos/variantes" },
    ],
  },
  {
    label: "Presupuestos",
    href: "/admin/presupuestos",
    icon: FileText,
    roles: ["admin", "agente"],
    children: [
      { label: "Leads", href: "/admin/presupuestos/leads" },
      { label: "Presupuestos", href: "/admin/presupuestos/lista" },
      { label: "Nuevo Presupuesto", href: "/admin/presupuestos/nuevo" },
    ],
  },
  {
    label: "Operaciones",
    href: "/admin/operaciones",
    icon: Calendar,
    roles: ["admin", "agente", "monitor"],
    children: [
      { label: "Calendario", href: "/admin/operaciones/calendario" },
      { label: "Reservas", href: "/admin/operaciones/reservas" },
      { label: "Reservas Redsys", href: "/admin/operaciones/reservas-redsys" },
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

  const isActive = (href: string) => location === href || location.startsWith(href + "/");

  const filteredNav = navItems.filter((item) => item.roles.includes(userRole));

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
              src="https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/logo-nayade-azul_ea3fd894.jpg"
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
                      <item.icon className="w-4 h-4 shrink-0" />
                      {sidebarOpen && (
                        <>
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} />
                        </>
                      )}
                    </button>
                    {sidebarOpen && isExpanded && item.children && (
                      <div className="ml-4 mt-1 space-y-0.5">
                        {item.children.map((child) => (
                          <Link key={child.href} href={child.href}>
                            <div className={cn(
                              "block px-3 py-2 rounded-lg text-xs font-medium transition-all",
                              location === child.href
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
                      {sidebarOpen && <span>{item.label}</span>}
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
            <Button variant="ghost" size="icon" className="w-9 h-9 relative">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
            </Button>
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
