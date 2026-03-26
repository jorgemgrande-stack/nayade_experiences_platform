import { useAuth } from "@/_core/hooks/useAuth";
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
  Receipt, TrendingDown, RefreshCw, Tag, Building2, TrendingUp, ChevronDown, ChevronRight,
} from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

type SubItem = { icon: React.ElementType; label: string; path: string };
type MenuItem = { icon: React.ElementType; label: string; path: string; children?: SubItem[] };

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: "Dashboard",    path: "/admin" },
  { icon: Image,           label: "CMS",          path: "/admin/cms" },
  { icon: Package,         label: "Productos",    path: "/admin/productos" },
  { icon: FileText,        label: "CRM",          path: "/admin/crm" },
  { icon: Calendar,        label: "Operaciones",  path: "/admin/operaciones" },
  {
    icon: BarChart3, label: "Contabilidad", path: "/admin/contabilidad",
    children: [
      { icon: BarChart3,    label: "Dashboard",          path: "/admin/contabilidad/dashboard" },
      { icon: TrendingDown, label: "Gastos",              path: "/admin/contabilidad/gastos" },
      { icon: RefreshCw,    label: "Recurrentes",         path: "/admin/contabilidad/gastos/recurrentes" },
      { icon: Tag,          label: "Categorías gastos",   path: "/admin/contabilidad/gastos/categorias" },
      { icon: Building2,    label: "Proveedores gastos",  path: "/admin/contabilidad/gastos/proveedores" },
      { icon: TrendingUp,   label: "Cuenta Resultados",   path: "/admin/contabilidad/cuenta-resultados" },
    ],
  },
  { icon: Receipt,          label: "Fiscal REAV",  path: "/admin/fiscal/reav" },
  { icon: BedDouble,        label: "Hotel",        path: "/admin/hotel" },
  { icon: Sparkles,         label: "SPA",          path: "/admin/spa" },
  { icon: UtensilsCrossed,  label: "Restaurantes", path: "/admin/restaurantes" },
  { icon: Users,            label: "Usuarios",     path: "/admin/usuarios" },
  { icon: Settings,         label: "Configuración",path: "/admin/configuracion" },
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

  // Track which expandable sections are open
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() => {
    // Auto-expand the section that contains the current path
    const expanded: Record<string, boolean> = {};
    menuItems.forEach((item) => {
      if (item.children?.some((c) => location.startsWith(c.path))) {
        expanded[item.path] = true;
      }
    });
    return expanded;
  });

  const activeMenuItem = menuItems.find((item) =>
    item.children ? item.children.some((c) => location.startsWith(c.path)) : item.path === location
  );

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

  function toggleSection(path: string) {
    setExpandedSections((prev) => ({ ...prev, [path]: !prev[path] }));
  }

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
              {menuItems.map((item) => {
                const hasChildren = !!item.children?.length;
                const isExpanded = expandedSections[item.path];
                const isSectionActive = hasChildren
                  ? item.children!.some((c) => location.startsWith(c.path))
                  : location === item.path;

                return (
                  <SidebarMenuItem key={item.path}>
                    {/* Parent item */}
                    <SidebarMenuButton
                      isActive={isSectionActive && !hasChildren}
                      onClick={() => {
                        if (hasChildren) {
                          toggleSection(item.path);
                        } else {
                          setLocation(item.path);
                        }
                      }}
                      tooltip={item.label}
                      className={`h-10 transition-all font-normal ${isSectionActive ? "text-primary" : ""}`}
                    >
                      <item.icon className={`h-4 w-4 shrink-0 ${isSectionActive ? "text-primary" : ""}`} />
                      <span className="flex-1">{item.label}</span>
                      {hasChildren && !isCollapsed && (
                        isExpanded
                          ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          : <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </SidebarMenuButton>

                    {/* Children submenu */}
                    {hasChildren && isExpanded && !isCollapsed && (
                      <div className="ml-4 mt-0.5 mb-1 border-l border-border pl-2 space-y-0.5">
                        {item.children!.map((child) => {
                          const isChildActive = location.startsWith(child.path);
                          return (
                            <button
                              key={child.path}
                              onClick={() => setLocation(child.path)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors
                                ${isChildActive
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                }`}
                            >
                              <child.icon className="h-3 w-3 shrink-0" />
                              <span className="truncate">{child.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
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
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">{activeMenuItem?.label ?? "Menu"}</span>
                </div>
              </div>
            </div>
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}
