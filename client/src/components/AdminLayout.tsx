import { useState, useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  LayoutDashboard, Package, FileText, Calendar, BarChart3,
  Settings, Menu, X, LogOut, Users, Image, ChevronDown,
  Bell, Search, User, BedDouble, Sparkles, UtensilsCrossed, AlertCircle,
  UserPlus, FileCheck, ChevronRight, Receipt, Truck, Monitor, Tag, Ticket,
  Sun, Moon, ExternalLink, Target, MessageCircle, Bot, Mail, Building2,
  Briefcase, Globe, CreditCard, ShoppingCart, Rocket, ArrowUpRight, HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/_core/hooks/useAuth";
import { WhatsAppNotification } from "./WhatsAppNotification";
import { cn } from "@/lib/utils";
import { useLocation as useWouterLocation } from "wouter";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/contexts/ThemeContext";
import MaintenanceModeControl from "./admin/MaintenanceModeControl";

import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import {
  LEGACY_SECTIONS, TASK_NAV, resolveNav,
  type NavIcon, type ResolvedItem, type ResolvedSection,
} from "@shared/adminNav";
import { helpForLocation } from "@shared/helpCenter";

/** Iconos del menú (el modelo de navegación vive en shared/adminNav.ts, sin React). */
const NAV_ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, image: Image, package: Package, file: FileText, building: Building2,
  target: Target, calendar: Calendar, briefcase: Briefcase, chart: BarChart3, receipt: Receipt,
  monitor: Monitor, truck: Truck, bed: BedDouble, sparkles: Sparkles, utensils: UtensilsCrossed,
  tag: Tag, users: Users, settings: Settings, globe: Globe, creditCard: CreditCard,
  shoppingCart: ShoppingCart, rocket: Rocket, message: MessageCircle, bot: Bot, mail: Mail, help: HelpCircle,
};

/** Etiqueta y color por rol */
const ROLE_META: Record<string, { label: string; color: string }> = {
  admin:     { label: "Administrador",         color: "text-red-400" },
  agente:    { label: "Agente Comercial",       color: "text-blue-400" },
  monitor:   { label: "Monitor",               color: "text-green-400" },
  adminrest: { label: "Gestor Restaurantes",   color: "text-orange-400" },
  controler: { label: "Controler",             color: "text-purple-400" },
  user:      { label: "Usuario",               color: "text-gray-400" },
  readonly:  { label: "Solo lectura",          color: "text-gray-400" },
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title?: string;
}

export default function AdminLayout({ children, title }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [location, navigate] = useWouterLocation();
  const currentSearch = useSearch();
  const { user, logout, loading, isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();

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

  // ── Guard: controler solo puede acceder a Control Diario ──
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "controler") {
      if (!location.startsWith("/admin/contabilidad/control-diario")) {
        navigate("/admin/contabilidad/control-diario");
      }
    }
  }, [loading, isAuthenticated, userRole, location, navigate]);

  // Cerrar menú móvil al cambiar de ruta
  useEffect(() => { setMobileMenuOpen(false); }, [location]);

  // Escape cierra el menú móvil
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  const toggleExpanded = (href: string) => {
    setExpandedItems((prev) =>
      prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href]
    );
  };

  const isActive = (href: string) => {
    if (href === "/admin") return location === "/admin";
    return location === href || location.startsWith(href + "/") || location.startsWith(href + "?");
  };
  // Para sub-items con ?tab= en el href: compara pathname + search
  const isChildActive = (childHref: string) => {
    if (!childHref.includes("?")) return location === childHref;
    const [childPath, childQuery] = childHref.split("?");
    if (location !== childPath) return false;
    // Comparar todos los params del child con la URL actual
    const childParams = new URLSearchParams(childQuery);
    const currentParams = new URLSearchParams(currentSearch);
    for (const [key, val] of Array.from(childParams.entries())) {
      if (currentParams.get(key) !== val) return false;
    }
    return true;
  };

  // Public brand settings — logo, name, colors.
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const LOGO_FALLBACK = "https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png";
  const brandName = publicSettings?.brand_name || "Admin";

  // Feature flags — used to hide nav items for disabled modules.
  // Defaults to showing all items when flags are not yet loaded (safe fallback).
  const { data: flagsList } = trpc.config.listFeatureFlags.useQuery(undefined, {
    enabled: isAuthenticated && userRole === "admin",
    staleTime: 120_000,
    refetchIntervalInBackground: false,
  });
  const flagsMap = new Map<string, boolean>((flagsList ?? []).map(f => [f.key, f.enabled]));
  const isFlagVisible = (flagKey?: string) => {
    if (!flagKey || !flagsList) return true;
    return flagsMap.get(flagKey) !== false;
  };

  // Módulos disponibles para este tenant (licencia + dependencias + flag), desde el servidor.
  // Mientras carga, o si falla, se muestra todo (la autorización real está en el servidor).
  const { data: modulesData } = trpc.modules.active.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 120_000,
    retry: false,
  });
  const isModuleVisible = (moduleKey?: string) => {
    if (!moduleKey || !modulesData) return true;
    return modulesData.modules.includes(moduleKey);
  };

  // Menú: el de siempre (single / sin licencias por capacidad) o por tareas filtrado por licencias.
  const subscription = usePanelSubscription();
  const navSections: ResolvedSection[] =
    subscription.mode === "loading"
      ? []
      : resolveNav(subscription.mode === "tasks" ? TASK_NAV : LEGACY_SECTIONS, {
          role: userRole,
          isFlagVisible,
          isModuleVisible,
          capabilityState: subscription.mode === "tasks" ? subscription.capabilityState : () => "active",
        });
  const isTaskNav = subscription.mode === "tasks";
  // Ayuda contextual de la pantalla actual (contenido en shared/helpCenter.ts)
  const contextHelp = isTaskNav ? helpForLocation(location, currentSearch) : undefined;
  const upgradeUrl = subscription.data?.upgradeUrl ?? null;
  const trialInfo = subscription.data?.trial ?? null;
  // Una empresa nueva sin logo propio no hereda el de la instalación original: se muestra su inicial.
  const brandLogo = publicSettings?.brand_logo_url || (subscription.mode === "legacy" ? LOGO_FALLBACK : null);

  // ── Feed unificado de notificaciones (polling cada 60s) ─────────────────
  // El endpoint `notifications.feed` agrega 6 fuentes (leads, quotes,
  // cancellations, pending_payments, tpv_alerts, upcoming_reservations),
  // excluyendo los items que este usuario ya ha silenciado.
  const utils = trpc.useUtils();
  const { data: feed } = trpc.notifications.feed.useQuery(undefined, {
    enabled: isAuthenticated && ["admin", "agente"].includes(userRole),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const totalAlerts = feed?.totalAlerts ?? 0;
  // Para mantener compat con badges del menú lateral (sidebar) que usan
  // estas dos variables para mostrar el punto rojo en CRM.
  const newLeads = feed?.sections.find(s => s.kind === "lead")?.total ?? 0;
  const pendingQuotes = feed?.sections.find(s => s.kind === "quote")?.total ?? 0;

  const dismissItem = trpc.notifications.dismiss.useMutation({
    onSuccess: () => utils.notifications.feed.invalidate(),
  });
  const dismissAllSection = trpc.notifications.dismissAll.useMutation({
    onSuccess: () => utils.notifications.feed.invalidate(),
  });

  type FeedKind = "lead" | "quote" | "cancellation" | "pending_payment" | "tpv_alert" | "upcoming_reservation" | "task";
  const severityColor: Record<string, string> = {
    info:     "text-sky-400",
    warning:  "text-amber-400",
    critical: "text-red-400",
  };
  const severityBg: Record<string, string> = {
    info:     "bg-sky-500/10 border-sky-500/30",
    warning:  "bg-amber-500/10 border-amber-500/30",
    critical: "bg-red-500/10 border-red-500/30",
  };

  // ── Los empleados no acceden al panel de admin: enviarlos a su portal ──
  // Evita el callejón sin salida de "Sin permisos" cuando un empleado abre /admin.
  useEffect(() => {
    if (!loading && isAuthenticated && userRole === "employee") {
      navigate("/empleado");
    }
  }, [loading, isAuthenticated, userRole, navigate]);

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
  if (!["admin", "agente", "monitor", "adminrest", "controler", "readonly"].includes(userRole)) {
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

  // En móvil el panel siempre se muestra completo (con textos), aunque en escritorio esté plegado.
  const showLabels = sidebarOpen || mobileMenuOpen;
  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";

  // Avisos numéricos del menú por tareas (mismos datos que la campana).
  const badgeFor = (item: ResolvedItem): { n: number; tone: "red" | "amber"; label: string } | null => {
    if (!isTaskNav) return null;
    if (item.key === "t-oportunidades" && newLeads > 0) return { n: newLeads, tone: "red", label: "oportunidades nuevas sin atender" };
    if (item.key === "t-presupuestos" && pendingQuotes > 0) return { n: pendingQuotes, tone: "amber", label: "presupuestos enviados sin respuesta" };
    return null;
  };

  const renderNavItem = (item: ResolvedItem) => {
    const Icon = NAV_ICONS[item.icon] ?? LayoutDashboard;
    const active = isActive(item.href);
    const id = item.key ?? item.href;
    const badge = badgeFor(item);
    const badgeEl = badge && (
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold px-1",
          badge.tone === "red" ? "bg-red-600" : "bg-amber-600",
        )}
      >
        {badge.n > 99 ? "99+" : badge.n}
        <span className="sr-only"> {badge.label}</span>
      </span>
    );
    const readOnlyTag = item.readOnly && showLabels && (
      <span className="text-[10px] font-medium rounded px-1.5 py-0.5 bg-sidebar-accent text-sidebar-foreground/80">Solo lectura</span>
    );

    if (item.children) {
      const isExpanded = expandedItems.includes(id) || active || item.children.some((c) => isChildActive(c.href));
      const panelId = `nav-${id.replace(/[^a-z0-9-]/gi, "-")}`;
      return (
        <li key={id}>
          <button
            type="button"
            onClick={() => (showLabels ? toggleExpanded(id) : setSidebarOpen(true))}
            aria-expanded={showLabels ? isExpanded : undefined}
            aria-controls={showLabels ? panelId : undefined}
            title={showLabels ? undefined : item.label}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              focusRing,
              active
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {showLabels ? (
              <>
                <span className="flex-1 text-left">{item.label}</span>
                {readOnlyTag}
                {badgeEl}
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isExpanded && "rotate-180")} aria-hidden="true" />
              </>
            ) : (
              <span className="sr-only">{item.label}</span>
            )}
          </button>
          {showLabels && isExpanded && (
            <ul id={panelId} className="ml-4 mt-1 space-y-0.5">
              {item.children.map((child) => {
                const childActive = isChildActive(child.href);
                return (
                  <li key={child.key ?? child.href}>
                    <Link
                      href={child.href}
                      aria-current={childActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all",
                        focusRing,
                        childActive
                          ? "bg-sidebar-accent text-amber-400"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <span className="flex-1">{child.label}</span>
                      {child.readOnly && <span className="text-[10px] text-sidebar-foreground/70">Solo lectura</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      );
    }

    const leafActive = item.href.includes("?") ? isChildActive(item.href) : active;
    return (
      <li key={id}>
        <Link
          href={item.href}
          aria-current={leafActive ? "page" : undefined}
          title={showLabels ? undefined : item.label}
          className={cn(
            "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
            focusRing,
            leafActive
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
          )}
        >
          <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
          {showLabels ? (
            <>
              <span className="flex-1">{item.label}</span>
              {readOnlyTag}
              {badgeEl}
            </>
          ) : (
            <span className="sr-only">{item.label}</span>
          )}
        </Link>
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background flex">
      <a
        href="#contenido-principal"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido
      </a>
      {/* Mobile backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full z-50 flex flex-col transition-all duration-300",
          "bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
          // Desktop: respeta sidebarOpen toggle
          sidebarOpen ? "lg:w-64" : "lg:w-16",
          // Móvil: siempre ancho completo pero se oculta con translate
          "w-64",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border shrink-0">
          <Link
            href={userRole === "adminrest" ? "/admin/restaurantes" : "/admin"}
            className="flex items-center gap-2 min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={`${brandName}: ir al inicio del panel`}
          >
            {brandLogo ? (
              <img
                src={brandLogo}
                alt=""
                className={cn("object-contain rounded-full shrink-0", showLabels ? "h-10 w-10" : "h-8 w-8")}
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "rounded-full shrink-0 bg-sidebar-primary text-sidebar-primary-foreground font-display font-bold flex items-center justify-center",
                  showLabels ? "h-10 w-10 text-base" : "h-8 w-8 text-sm",
                )}
              >
                {brandName.trim().charAt(0).toUpperCase() || "A"}
              </span>
            )}
            {showLabels && (
              isTaskNav ? (
                <span className="text-sm font-display font-semibold text-sidebar-foreground truncate">{brandName}</span>
              ) : (
                <span className="text-xs text-amber-400 tracking-widest uppercase font-display font-bold shrink-0">
                  {userRole === "adminrest" ? "Restaurantes" : userRole === "controler" ? "Control" : "Admin"}
                </span>
              )
            )}
          </Link>
          {/* Escritorio: plegar/desplegar; móvil: cerrar el panel */}
          <button
            type="button"
            onClick={() => (mobileMenuOpen ? setMobileMenuOpen(false) : setSidebarOpen(!sidebarOpen))}
            aria-label={mobileMenuOpen ? "Cerrar menú" : sidebarOpen ? "Plegar menú lateral" : "Desplegar menú lateral"}
            aria-expanded={mobileMenuOpen || sidebarOpen}
            className="ml-auto w-8 h-8 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            {showLabels ? <X className="w-4 h-4" aria-hidden="true" /> : <Menu className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-2" aria-label="Menú del panel">
          {subscription.mode === "loading" && (
            <div className="space-y-2 px-1" aria-busy="true" aria-live="polite">
              <span className="sr-only">Cargando el menú…</span>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-sidebar-accent/60 animate-pulse" />
              ))}
            </div>
          )}
          {navSections.map((section) => (
            <div key={section.id} className="mb-3">
              {section.label && showLabels && (
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
                  {section.label}
                </p>
              )}
              {section.label && !showLabels && <div className="mx-3 my-2 border-t border-sidebar-border" aria-hidden="true" />}
              <ul className="space-y-1" aria-label={section.label ?? undefined}>
                {section.items.map((item) => renderNavItem(item))}
              </ul>
            </div>
          ))}
          {/* Ampliar: lo no contratado no aparece como activo; solo un acceso separado para ampliar */}
          {isTaskNav && userRole === "admin" && (
            <div className="mt-2 pt-3 border-t border-sidebar-border">
              {showLabels && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">Ampliar</p>
              )}
              {upgradeUrl ? (
                <a
                  href={upgradeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title={showLabels ? undefined : "Ver planes y módulos (se abre en otra pestaña)"}
                >
                  <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {showLabels ? <span className="flex-1">Ver planes y módulos</span> : <span className="sr-only">Ver planes y módulos</span>}
                  <span className="sr-only">(se abre en otra pestaña)</span>
                </a>
              ) : (
                <Link
                  href="/admin/suscripcion#ampliar"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  title={showLabels ? undefined : "Ampliar mi plan"}
                >
                  <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {showLabels ? <span className="flex-1">Ampliar mi plan</span> : <span className="sr-only">Ampliar mi plan</span>}
                </Link>
              )}
            </div>
          )}
        </nav>

        {/* User Profile */}
        <div className="border-t border-sidebar-border p-3 shrink-0">
          <div className={cn("flex items-center gap-3", !showLabels && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0" aria-hidden="true">
              <User className="w-4 h-4 text-amber-400" />
            </div>
            {showLabels && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name ?? "Usuario"}</p>
                <p className={cn("text-xs font-medium capitalize", roleMeta.color)}>{roleMeta.label}</p>
              </div>
            )}
            <button
              type="button"
              onClick={logout}
              className="w-8 h-8 rounded-lg hover:bg-sidebar-accent flex items-center justify-center text-sidebar-foreground/70 hover:text-red-400 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className={cn("flex-1 flex flex-col transition-all duration-300 min-w-0", sidebarOpen ? "lg:ml-64" : "lg:ml-16")}>
        {/* Top Bar */}
        <header className="h-16 bg-card border-b border-border flex items-center px-4 sm:px-6 gap-3 sticky top-0 z-30">
          {/* Hamburguesa — solo en móvil */}
          <button
            className="lg:hidden w-9 h-9 rounded-lg hover:bg-accent flex items-center justify-center text-foreground/60 hover:text-foreground transition-colors shrink-0"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="w-5 h-5" aria-hidden="true" />
          </button>
          {title && (
            <h1 className="font-display font-semibold text-base sm:text-lg text-foreground truncate min-w-0">{title}</h1>
          )}
          <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Prueba gratuita: días restantes (dato del servidor) */}
            {isTaskNav && trialInfo && userRole === "admin" && (
              <Link
                href="/admin/suscripcion"
                className={cn(
                  "hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  trialInfo.daysLeft <= 3
                    ? "border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                    : "border-border bg-muted text-foreground",
                )}
              >
                <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
                {trialInfo.daysLeft > 0
                  ? `Prueba: ${trialInfo.daysLeft} ${trialInfo.daysLeft === 1 ? "día" : "días"}`
                  : "Prueba finalizada"}
              </Link>
            )}
            {userRole === "admin" && <MaintenanceModeControl />}
            {!isTaskNav && (
              <Button variant="ghost" size="icon" className="w-9 h-9" aria-label="Buscar">
                <Search className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
            {/* Toggle Light / Dark */}
            <Button
              variant="ghost"
              size="icon"
              className="w-9 h-9"
              onClick={toggleTheme}
              title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            >
              {theme === "dark"
                ? <Sun className="w-4 h-4 text-amber-400" />
                : <Moon className="w-4 h-4" />
              }
            </Button>
            <Popover open={notifOpen} onOpenChange={setNotifOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-9 h-9 relative"
                  title={totalAlerts > 0 ? `${newLeads} leads nuevos · ${pendingQuotes} presupuestos pendientes` : "Sin alertas"}
                  aria-label={totalAlerts > 0 ? `Notificaciones: ${totalAlerts} pendientes` : "Notificaciones: ninguna pendiente"}
                >
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  {totalAlerts > 0 && (
                    <span className="absolute top-1 right-1 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5 leading-none">
                      {totalAlerts > 99 ? "99+" : totalAlerts}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-96 p-0 bg-card border border-border shadow-xl max-h-[80vh] overflow-y-auto"
                align="end"
                sideOffset={8}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-card z-10">
                  <span className="text-sm font-semibold text-foreground">Notificaciones</span>
                  {totalAlerts > 0 && (
                    <span className="text-xs bg-red-500 text-white rounded-full px-2 py-0.5 font-bold">
                      {totalAlerts}
                    </span>
                  )}
                </div>

                {/* Secciones del feed */}
                {(feed?.sections ?? []).filter(s => s.total > 0).map((section) => (
                  <div key={section.kind} className="border-b border-border last:border-b-0">
                    <div className="flex items-center justify-between px-4 pt-3 pb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base leading-none">{section.icon}</span>
                        <span className={`text-xs font-semibold uppercase tracking-wide ${severityColor[section.severity]}`}>
                          {section.label} ({section.total})
                        </span>
                      </div>
                      <button
                        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => dismissAllSection.mutate({ kind: section.kind as FeedKind })}
                        disabled={dismissAllSection.isPending}
                        title="Marcar toda la sección como vista"
                      >
                        Marcar todo
                      </button>
                    </div>
                    <div className="space-y-1 px-2 pb-2">
                      {section.items.map((item) => (
                        <div
                          key={`${item.kind}-${item.entityId}`}
                          className={`flex items-stretch gap-1 rounded-md border ${severityBg[item.severity]} group`}
                        >
                          <button
                            className="flex-1 text-left px-2 py-1.5 hover:bg-foreground/[0.04] transition-colors min-w-0"
                            onClick={() => { navigate(item.ctaPath); setNotifOpen(false); }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-foreground truncate">
                                {item.title}
                              </span>
                              {item.amount != null && (
                                <span className="text-xs font-semibold text-emerald-400 shrink-0">
                                  {item.amount.toFixed(2)}€
                                </span>
                              )}
                            </div>
                            {item.subtitle && (
                              <div className="text-xs text-muted-foreground truncate">
                                {item.subtitle}
                              </div>
                            )}
                          </button>
                          <button
                            className="px-2 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissItem.mutate({ kind: item.kind as FeedKind, entityId: item.entityId });
                            }}
                            disabled={dismissItem.isPending}
                            title="Marcar como visto (no afecta al estado real)"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {section.total > section.items.length && (
                        <button
                          className="w-full text-[11px] text-muted-foreground hover:text-foreground text-center py-1"
                          onClick={() => { navigate(section.ctaAllPath); setNotifOpen(false); }}
                        >
                          Ver los {section.total - section.items.length} restantes →
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Estado vacío */}
                {totalAlerts === 0 && (feed?.sections.every(s => s.total === 0) ?? true) && (
                  <div className="px-4 py-8 text-center">
                    <Bell className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Sin notificaciones pendientes</p>
                  </div>
                )}

                {/* Footer */}
                <div className="px-4 py-2 border-t border-border sticky bottom-0 bg-card">
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
            {isTaskNav && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-2 sm:px-3 text-xs gap-1.5" aria-label={contextHelp ? `Ayuda sobre esta pantalla: ${contextHelp.title}` : "Ayuda"}>
                    <HelpCircle className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Ayuda</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-4">
                  {contextHelp ? (
                    <>
                      <p className="text-sm font-semibold text-foreground">{contextHelp.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{contextHelp.summary}</p>
                      <Link href={`/admin/ayuda/${contextHelp.id}`} className="mt-3 inline-flex text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                        Ver la guía paso a paso
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Guías breves para crear clientes, productos, presupuestos, pedidos y facturas, invitar a tu equipo y gestionar tu suscripción.</p>
                  )}
                  <Link href="/admin/ayuda" className="mt-2 block text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                    Centro de ayuda y contacto
                  </Link>
                </PopoverContent>
              </Popover>
            )}
            {userRole !== "adminrest" && (
              <Link href="/" target="_blank">
                <Button variant="outline" size="sm" className="text-xs hidden sm:inline-flex">
                  Ver sitio web
                </Button>
                <Button variant="ghost" size="icon" className="sm:hidden w-9 h-9" title="Ver sitio web">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Page Content */}
        <main id="contenido-principal" tabIndex={-1} className="flex-1 p-4 sm:p-6 overflow-auto focus:outline-none">
          {children}
        </main>
      </div>
      <WhatsAppNotification />
    </div>
  );
}
