// v22.0 — RBAC-aware menu filtering with legacy fallback
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard, LogOut, PanelLeft, Package, FileText, Calendar,
  BarChart3, Settings, Users, Image, BedDouble, Sparkles, UtensilsCrossed,
  Receipt, TrendingDown, RefreshCw, Tag, Building2, TrendingUp,
  List, FileBarChart, Ticket, Percent, XCircle, Hash, ShoppingCart,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

type FlatMenuItem = {
  icon: React.ElementType;
  label: string;
  path: string;
  section?: string;    // section header label (only on first item of each section)
  indent?: boolean;    // visual indent for sub-items
  roles?: string[];    // if set, only shown for these legacy roles
  rbacPerm?: string;   // if set, also shown when user has this RBAC permission
};

const menuItems: FlatMenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard",       path: "/admin" },
  { icon: Image,           label: "CMS",             path: "/admin/cms",       roles: ["admin"] },
  { icon: Package,         label: "Productos",       path: "/admin/productos", roles: ["admin"] },
  { icon: FileText,        label: "CRM",             path: "/admin/crm",       roles: ["admin", "agente"] },
  { icon: Users,            label: "Clientes",        path: "/admin/crm/clientes",    indent: true, roles: ["admin", "agente"] },
  { icon: XCircle,          label: "Anulaciones",     path: "/admin/crm/anulaciones", indent: true, roles: ["admin", "agente"] },
  { icon: Calendar,        label: "Operaciones",     path: "/admin/operaciones", roles: ["admin", "agente", "monitor"] },
  // ── Contabilidad ──────────────────────────────────────────────────────────
  { icon: BarChart3,    label: "Dashboard Contab.",  path: "/admin/contabilidad/dashboard",          section: "Contabilidad", roles: ["admin"] },
  { icon: List,         label: "Transacciones",      path: "/admin/contabilidad/transacciones",      indent: true, roles: ["admin"] },
  { icon: FileBarChart, label: "Informes",           path: "/admin/contabilidad/informes",           indent: true, roles: ["admin"] },
  { icon: TrendingDown, label: "Gastos",             path: "/admin/contabilidad/gastos",             indent: true, roles: ["admin"], rbacPerm: "accounting.expenses.view" },
  { icon: RefreshCw,    label: "Recurrentes",        path: "/admin/contabilidad/gastos/recurrentes", indent: true, roles: ["admin"] },
  { icon: Tag,          label: "Categ. gastos",      path: "/admin/contabilidad/gastos/categorias",  indent: true, roles: ["admin"] },
  { icon: Building2,    label: "Proveedores gastos", path: "/admin/contabilidad/gastos/proveedores", indent: true, roles: ["admin"] },
  { icon: TrendingUp,   label: "Cuenta Resultados",  path: "/admin/contabilidad/cuenta-resultados",  indent: true, roles: ["admin"] },
  // ── Marketing ─────────────────────────────────────────────────────────────────────────────────
  { icon: ShoppingCart, label: "TPV",             path: "/admin/tpv",                  section: "Marketing", roles: ["admin", "agente"] },
  { icon: Ticket,  label: "Cupones & Ticketing", path: "/admin/marketing/cupones",    indent: true,         roles: ["admin", "agente"], rbacPerm: "ticketing.view" },
  { icon: Percent, label: "Códigos descuento",   path: "/admin/marketing/descuentos", indent: true,         roles: ["admin", "agente"] },
  // ── Otros ───────────────────────────────────────────────────────────────────────────────────
  { icon: Receipt,          label: "Fiscal REAV",   path: "/admin/fiscal/reav",  section: "Otros", roles: ["admin"] },
  { icon: BedDouble,        label: "Hotel",         path: "/admin/hotel",                          roles: ["admin"] },
  { icon: Sparkles,         label: "SPA",           path: "/admin/spa",                            roles: ["admin"] },
  { icon: UtensilsCrossed,  label: "Restaurantes",  path: "/admin/restaurantes",                   roles: ["admin", "adminrest"] },
  { icon: Users,            label: "Usuarios",      path: "/admin/usuarios",      roles: ["admin"], rbacPerm: "users.view" },
  { icon: Settings,         label: "Configuración", path: "/admin/configuracion", roles: ["admin"], rbacPerm: "settings.view" },
  { icon: Hash,             label: "Series Numer.",  path: "/admin/numeracion",  indent: true,     roles: ["admin"] },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) return <DashboardLayoutSkeleton />;

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">Sign in to continue</h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to launch the login flow.
            </p>
          </div>
          <Button onClick={() => { window.location.href = getLoginUrl(); }} size="lg" className="w-full shadow-lg hover:shadow-xl transition-all">
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = { children: React.ReactNode; setSidebarWidth: (width: number) => void };

function DashboardLayoutContent({ children, setSidebarWidth }: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const userRole = user?.role ?? "user";
  // RBAC permission check (staleTime=5min so it doesn't refetch on every navigation)
  const { data: myPermissions = null } = trpc.auth.myPermissions.useQuery(undefined, {
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const visibleMenuItems = menuItems.filter(item => {
    if (!item.roles) return true;
    // Legacy role check (always applies as fallback)
    const hasLegacyRole = item.roles.includes(userRole);
    // RBAC check: if permissions loaded and item has a rbacPerm, also grant if user has it
    if (myPermissions !== null && item.rbacPerm) {
      return hasLegacyRole || myPermissions.includes(item.rbacPerm);
    }
    return hasLegacyRole;
  });

  const activeMenuItem = visibleMenuItems.find((item) => {
    if (item.path === "/admin") return location === "/admin";
    return location.startsWith(item.path);
  });

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar collapsible="icon" className="border-r-0" disableTransition={isResizing}>
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">Navigation</span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0">
            <SidebarMenu className="px-2 py-1">
              {visibleMenuItems.map((item) => {
                const isActive = item.path === "/admin"
                  ? location === "/admin"
                  : location.startsWith(item.path);

                return (
                  <SidebarMenuItem key={item.path}>
                    {/* Section header label */}
                    {item.section && !isCollapsed && (
                      <div className="px-2 pt-3 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                          {item.section}
                        </span>
                        <div className="mt-1 h-px bg-border/50" />
                      </div>
                    )}

                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => setLocation(item.path)}
                      tooltip={item.label}
                      className={`h-9 transition-all font-normal ${item.indent && !isCollapsed ? "ml-3 w-[calc(100%-0.75rem)]" : ""} ${isActive ? "text-primary" : ""}`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`} />
                      <span className="flex-1 truncate">{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">{user?.name || "-"}</p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">{user?.email || "-"}</p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={logout} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => { if (isCollapsed) return; setIsResizing(true); }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-2">
                <span className="tracking-tight text-foreground">{activeMenuItem?.label ?? "Menu"}</span>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
