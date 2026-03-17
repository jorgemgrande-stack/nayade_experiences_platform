import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, FileText, Calendar, BarChart3,
  Settings, Menu, X, Mountain, LogOut, Users, Image, ChevronDown,
  Bell, Search, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useLocation as useWouterLocation } from "wouter";

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

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [location] = useWouterLocation();
  const { user, logout } = useAuth();

  const toggleExpanded = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  };

  const isActive = (href: string) => location === href || location.startsWith(href + "/");
  const userRole = (user as any)?.role ?? "user";

  const filteredNav = navItems.filter((item) => item.roles.includes(userRole));

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
          <Link href="/admin" className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gold-gradient flex items-center justify-center shrink-0">
              <Mountain className="w-4 h-4 text-white" />
            </div>
            {sidebarOpen && (
              <div className="flex flex-col leading-none min-w-0">
                <span className="font-display font-bold text-sm text-sidebar-foreground truncate">NAYADE</span>
                <span className="text-xs text-amber-400 tracking-widest uppercase">Admin</span>
              </div>
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
                <p className="text-xs text-sidebar-foreground/50 capitalize">{userRole}</p>
              </div>
            )}
            {sidebarOpen && (
              <button
                onClick={logout}
                className="w-7 h-7 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/50 hover:text-red-400 transition-colors"
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
            <Link href="/" target="_blank">
              <Button variant="outline" size="sm" className="text-xs">
                Ver sitio web
              </Button>
            </Link>
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
